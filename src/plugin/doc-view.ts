import { join } from "node:path";
import {
  Component,
  getFrontMatterInfo,
  type HoverParent,
  type HoverPopover,
  ItemView,
  MarkdownRenderer,
  Notice,
  parseYaml,
  type TAbstractFile,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { readItem } from "../store";
import { type Citation, citedRow, designOutline, parseCitation, stepIndex } from "./context";
import { REFRESH_DELAY_MS } from "./dom";
import type AgentsPlugin from "./main";

export const DOC_VIEW_TYPE = "agents-inbox-doc";
export const HOVER_SOURCE = "agents-inbox";

export interface DocState {
  path: string;
  itemPath: string;
  subpath: string | null;
  row: number | null;
}

interface ConcernRow {
  order: unknown;
  concern: unknown;
  outcome: unknown;
  after: unknown;
  stage: unknown;
}

const STEP_LABELS = ["not started", "sliced", "built", "critiqued", "committed", "pr-open", "landed"];
const CONCERN_COLUMNS: { key: keyof ConcernRow; label: string }[] = [
  { key: "order", label: "Order" },
  { key: "concern", label: "Concern" },
  { key: "outcome", label: "Outcome" },
  { key: "after", label: "After" },
  { key: "stage", label: "Stage" },
];

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const BASE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*base[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

export function handleLinks(
  view: ItemView & HoverParent,
  el: HTMLElement,
  sourcePath: () => string,
  open: (linktext: string, citation: Citation | null) => void,
): void {
  view.registerDomEvent(el, "click", (event) => {
    const link = internalLink(event.target);
    if (link === null) return;
    event.preventDefault();
    event.stopPropagation();
    const linktext = linktextOf(link);
    const source = sourcePath();
    open(
      linktext,
      parseCitation(linktext, link.textContent, (linkpath) => view.app.metadataCache.getFirstLinkpathDest(linkpath, source)?.path ?? null),
    );
  });
  view.registerDomEvent(el, "mouseover", (event) => {
    const link = internalLink(event.target);
    if (link === null) return;
    view.app.workspace.trigger("hover-link", {
      event,
      source: HOVER_SOURCE,
      hoverParent: view,
      targetEl: link,
      linktext: linktextOf(link),
      sourcePath: sourcePath(),
    });
  });
}

export class InboxDocView extends ItemView implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  private state: DocState = { path: "", itemPath: "", subpath: null, row: null };
  private component: Component | null = null;
  private timer: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  private readonly headerEl = createDiv({ cls: "agents-inbox-doc-header" });
  private readonly pathEl = this.headerEl.createSpan({ cls: "agents-inbox-doc-path" });
  private readonly openButton = this.headerEl.createEl("button", { cls: "agents-inbox-doc-open", text: "Open in editor" });
  private readonly scrollEl = createDiv({ cls: "agents-inbox-doc-scroll" });

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AgentsPlugin,
  ) {
    super(leaf);
    this.openButton.onclick = () => void this.openInEditor();
  }

  getViewType(): string {
    return DOC_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.state.path === "" ? "Map document" : this.state.path.replace(/\.md$/, "").split("/").slice(-2).join("/");
  }

  getIcon(): string {
    return "file-text";
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  async setState(state: Partial<DocState>, result: ViewStateResult): Promise<void> {
    this.state = {
      path: typeof state.path === "string" ? state.path : "",
      itemPath: typeof state.itemPath === "string" ? state.itemPath : "",
      subpath: typeof state.subpath === "string" ? state.subpath : null,
      row: typeof state.row === "number" ? state.row : null,
    };
    await super.setState(state, result);
    await this.enqueue(true);
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("agents-inbox-doc");
    this.contentEl.append(this.headerEl, this.scrollEl);
    handleLinks(
      this,
      this.scrollEl,
      () => this.state.path,
      (linktext, citation) => this.follow(linktext, citation),
    );
    const touched = (file: TAbstractFile, oldPath?: string) => {
      if (file.path === this.state.path || oldPath === this.state.path) this.schedule();
    };
    this.registerEvent(this.app.vault.on("modify", touched));
    this.registerEvent(this.app.vault.on("create", touched));
    this.registerEvent(this.app.vault.on("delete", touched));
    this.registerEvent(this.app.vault.on("rename", touched));
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.enqueue(false);
    }, REFRESH_DELAY_MS);
  }

  private enqueue(scroll: boolean): Promise<void> {
    this.queue = this.queue
      .then(() => this.render(scroll))
      .catch((error) => {
        new Notice(`Inbox: ${(error as Error).message}`);
      });
    return this.queue;
  }

  private follow(linktext: string, citation: Citation | null): void {
    if (citation === null) {
      new Notice(`Inbox: no document for ${linktext}`);
      return;
    }
    if (!citation.vaultPath.endsWith(".md")) {
      void this.app.workspace.openLinkText(linktext, this.state.path, "tab");
      return;
    }
    const state: DocState = { path: citation.vaultPath, itemPath: this.state.itemPath, subpath: citation.subpath, row: citation.row };
    this.plugin.showDoc(this.leaf, state).catch((error) => {
      new Notice(`Inbox: ${(error as Error).message}`);
    });
  }

  private async openInEditor(): Promise<void> {
    const file = this.app.vault.getFileByPath(this.state.path);
    if (file !== null) await this.app.workspace.getLeaf("tab").openFile(file);
  }

  private async render(scroll: boolean): Promise<void> {
    const { path, subpath } = this.state;
    const kept = this.scrollEl.scrollTop;
    this.pathEl.setText(path);
    if (this.component !== null) this.removeChild(this.component);
    this.component = null;
    this.scrollEl.empty();

    const file = this.app.vault.getFileByPath(path);
    this.openButton.toggle(file !== null);
    if (file === null) {
      const missing = this.scrollEl.createDiv({ cls: "agents-inbox-doc-missing" });
      missing.createDiv({ cls: "agents-inbox-doc-missing-title", text: "This document no longer exists" });
      missing.createDiv({ cls: "agents-inbox-doc-missing-path", text: path });
      this.contentEl.dataset.path = path;
      return;
    }

    const text = await this.app.vault.read(file);
    const { fields, body } = frontmatterOf(text);
    const component = this.addChild(new Component());
    this.component = component;
    const docEl = this.scrollEl.createDiv({ cls: "agents-inbox-doc-body markdown-rendered" });
    const renderPart = async (markdown: string) => {
      await MarkdownRenderer.render(this.app, markdown, docEl.createDiv({ cls: "agents-inbox-doc-part" }), path, component);
    };

    const type = fields.type;
    const concerns = type === "map" ? splitConcerns(body) : null;
    if (type === "map" && concerns !== null) {
      await renderPart(concerns.before);
      docEl.append(await this.concernTable(file, fields.map));
      await renderPart(concerns.after);
    } else {
      await renderPart(body);
    }

    if (type === "requirements") {
      const index = citedRow(text, subpath, this.state.row);
      if (index !== null && subpath !== null) tableRowsUnder(docEl, subpath)[index - 1]?.addClass("is-cited");
    } else if (type === "design") {
      const outline = designOutline(text);
      if (outline.length > 0) this.scrollEl.prepend(this.outlineStrip(outline));
    } else if (type === "implementation") {
      const step = fields.step === undefined ? null : fields.step;
      const at = step === null || typeof step === "string" ? stepIndex(step) : -1;
      if (at !== -1) this.scrollEl.prepend(stepStrip(at));
    }

    if (scroll) {
      this.scrollEl.scrollTop = 0;
      if (subpath !== null) findHeading(docEl, subpath)?.scrollIntoView({ block: "start" });
    } else {
      this.scrollEl.scrollTop = kept;
    }
    this.contentEl.dataset.path = path;
  }

  private outlineStrip(outline: string[]): HTMLElement {
    const strip = createEl("nav", { cls: "agents-inbox-outline", attr: { "aria-label": "Design outline" } });
    for (const heading of outline) {
      const entry = strip.createEl("button", { cls: "agents-inbox-outline-entry", text: heading });
      entry.onclick = () => {
        const body = this.scrollEl.querySelector<HTMLElement>(".agents-inbox-doc-body");
        if (body !== null) findHeading(body, heading)?.scrollIntoView({ block: "start" });
      };
    }
    return strip;
  }

  private async concernTable(mapFile: TFile, map: unknown): Promise<HTMLElement> {
    const folder = mapFile.parent?.path ?? "";
    const prefix = folder === "" || folder === "/" ? "" : `${folder}/`;
    const rows: ConcernRow[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name !== "concern.md" || !file.path.startsWith(prefix)) continue;
      const { fields } = frontmatterOf(await this.app.vault.cachedRead(file));
      if (fields.type !== "concern" || fields.map !== map) continue;
      rows.push({ order: fields.order, concern: fields.concern, outcome: fields.outcome, after: fields.after, stage: fields.stage });
    }
    rows.sort(compareConcerns);
    const current = this.itemConcern();

    const table = createEl("table", { cls: "agents-inbox-concerns" });
    const head = table.createEl("thead").createEl("tr");
    for (const { label } of CONCERN_COLUMNS) head.createEl("th", { text: label });
    const tbody = table.createEl("tbody");
    for (const row of rows) {
      const tr = tbody.createEl("tr");
      tr.dataset.concern = cell(row.concern);
      tr.toggleClass("is-item", current !== null && row.concern === current);
      for (const { key } of CONCERN_COLUMNS) tr.createEl("td", { text: cell(row[key]) });
    }
    return table;
  }

  private itemConcern(): string | null {
    if (this.state.itemPath === "") return null;
    try {
      return readItem(join(this.plugin.docs, this.state.itemPath)).concern;
    } catch {
      return null;
    }
  }
}

function stepStrip(at: number): HTMLElement {
  const strip = createEl("ol", { cls: "agents-inbox-steps", attr: { "aria-label": "Implementation step" } });
  STEP_LABELS.forEach((label, index) => {
    const step = strip.createEl("li", { cls: "agents-inbox-step", text: label });
    step.dataset.step = label;
    step.toggleClass("is-done", index < at);
    step.toggleClass("is-current", index === at);
    if (index === at) step.setAttr("aria-current", "step");
  });
  return strip;
}

function internalLink(target: EventTarget | null): HTMLAnchorElement | null {
  const el = target as Element | null;
  return typeof el?.closest === "function" ? el.closest<HTMLAnchorElement>("a.internal-link") : null;
}

function linktextOf(link: HTMLAnchorElement): string {
  return link.dataset.href ?? link.getAttribute("href") ?? "";
}

function frontmatterOf(text: string): { fields: Record<string, unknown>; body: string } {
  const info = getFrontMatterInfo(text);
  if (!info.exists) return { fields: {}, body: text };
  let fields: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(info.frontmatter);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>;
  } catch {
    fields = {};
  }
  return { fields, body: text.slice(info.contentStart) };
}

function splitConcerns(markdown: string): { before: string; after: string } | null {
  const lines = markdown.split("\n");
  let fence: string | null = null;
  let inConcerns = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence !== null) {
      if (closes(line, fence)) fence = null;
      continue;
    }
    const base = BASE_FENCE.exec(line);
    if (base !== null && inConcerns) {
      const end = lines.findIndex((other, j) => j > i && closes(other, base[1]));
      return { before: lines.slice(0, i).join("\n"), after: lines.slice(end === -1 ? lines.length : end + 1).join("\n") };
    }
    const open = FENCE.exec(line);
    if (open !== null) {
      fence = open[1];
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading === null) continue;
    if (heading[1].length === 2 && (heading[2] ?? "").trim().toLowerCase() === "concerns") inConcerns = true;
    else if (heading[1].length <= 2) inConcerns = false;
  }
  return null;
}

function closes(line: string, fence: string): boolean {
  const trimmed = line.trim();
  return line.search(/\S/) <= 3 && trimmed.length >= fence.length && [...trimmed].every((char) => char === fence[0]);
}

function headingsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
}

function headingText(heading: HTMLElement): string {
  return (heading.textContent ?? "").trim().toLowerCase();
}

function findHeading(root: HTMLElement, subpath: string): HTMLElement | null {
  const target = subpath.trim().toLowerCase();
  return headingsOf(root).find((heading) => headingText(heading) === target) ?? null;
}

function tableRowsUnder(root: HTMLElement, subpath: string): HTMLElement[] {
  const target = subpath.trim().toLowerCase();
  const blocks = [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, table")];
  const start = blocks.findIndex((el) => el.tagName !== "TABLE" && headingText(el) === target);
  if (start === -1) return [];
  const level = Number(blocks[start].tagName.slice(1));
  for (const el of blocks.slice(start + 1)) {
    if (el.tagName === "TABLE") return [...el.querySelectorAll<HTMLElement>("tbody tr")];
    if (Number(el.tagName.slice(1)) <= level) return [];
  }
  return [];
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(cell).join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function compareConcerns(a: ConcernRow, b: ConcernRow): number {
  const left = typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY;
  const right = typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;
  if (left !== right) return left < right ? -1 : 1;
  return cell(a.concern).localeCompare(cell(b.concern));
}
