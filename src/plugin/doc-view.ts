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
import { type Citation, parseCitation, STEPS, stepIndex } from "./context";
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

const STEP_LABELS = STEPS.map((step) => step ?? "not started");
const CONCERN_COLUMNS: { key: keyof ConcernRow; label: string }[] = [
  { key: "order", label: "Order" },
  { key: "concern", label: "Concern" },
  { key: "outcome", label: "Outcome" },
  { key: "after", label: "After" },
  { key: "stage", label: "Stage" },
];

export function handleLinks(
  view: ItemView & HoverParent,
  el: HTMLElement,
  sourcePath: () => string,
  open: (linktext: string, citation: Citation) => void,
): void {
  view.registerDomEvent(el, "click", (event) => {
    const link = internalLink(event.target);
    if (link === null) return;
    event.preventDefault();
    event.stopPropagation();
    const linktext = linktextOf(link);
    const source = sourcePath();
    const citation = parseCitation(linktext, link.textContent, (linkpath) => view.app.metadataCache.getFirstLinkpathDest(linkpath, source)?.path ?? null);
    if (citation === null) {
      new Notice(`Inbox: no document for ${linktext}`);
      return;
    }
    open(linktext, citation);
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
    void this.enqueue(true);
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
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (oldPath === this.state.path) this.state = { ...this.state, path: file.path };
        touched(file, oldPath);
      }),
    );
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

  private follow(linktext: string, citation: Citation): void {
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
    const { path, subpath, row, itemPath } = this.state;
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
    await MarkdownRenderer.render(this.app, body, docEl, path, component);

    const type = fields.type;
    const concerns = type === "map" ? concernsBlock(docEl) : null;
    if (concerns !== null) concerns.replaceWith(await this.concernTable(file, fields.map, itemPath));

    const segments = (subpath ?? "").split("#").filter((segment) => segment.trim() !== "");
    const targets = await Promise.all(segments.map((segment) => this.renderedHeading(segment, path, component)));
    const heading = targets.length === 0 ? null : findHeading(docEl, targets);
    if (type === "requirements") {
      if (heading !== null && row !== null) tableRowsUnder(docEl, heading)[row - 1]?.addClass("is-cited");
    } else if (type === "design") {
      const outline = headingsOf(docEl).filter((heading) => heading.tagName === "H2");
      if (outline.length > 0) this.scrollEl.prepend(outlineStrip(outline));
    } else if (type === "implementation") {
      const step = fields.step === undefined ? null : fields.step;
      const at = step === null || typeof step === "string" ? stepIndex(step) : -1;
      if (at !== -1) this.scrollEl.prepend(stepStrip(at));
    }

    if (scroll) {
      this.scrollEl.scrollTop = 0;
      heading?.scrollIntoView({ block: "start" });
    } else {
      this.scrollEl.scrollTop = kept;
    }
    this.contentEl.dataset.path = path;
  }

  private async renderedHeading(subpath: string, path: string, component: Component): Promise<string> {
    const el = createDiv();
    await MarkdownRenderer.render(this.app, `# ${subpath}`, el, path, component);
    return headingText(el.querySelector<HTMLElement>("h1") ?? el);
  }

  private async concernTable(mapFile: TFile, map: unknown, itemPath: string): Promise<HTMLElement> {
    const folder = mapFile.parent?.path ?? "";
    const prefix = folder === "" || folder === "/" ? "" : `${folder}/`;
    const rows: ConcernRow[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.name !== "concern.md" || !file.path.startsWith(prefix)) continue;
      const fields: Record<string, unknown> = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      if (fields.type !== "concern" || fields.map !== map) continue;
      rows.push({ order: fields.order, concern: fields.concern, outcome: fields.outcome, after: fields.after, stage: fields.stage });
    }
    rows.sort(compareConcerns);
    const current = this.itemConcern(itemPath);

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

  private itemConcern(itemPath: string): string | null {
    if (itemPath === "") return null;
    try {
      return readItem(join(this.plugin.docs, itemPath)).concern;
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

function concernsBlock(root: HTMLElement): HTMLElement | null {
  const blocks = [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, .block-language-base, code.language-base")].filter(outsideEmbeds);
  const start = blocks.findIndex((el) => el.tagName === "H2" && headingText(el) === "concerns");
  if (start === -1) return null;
  for (const el of blocks.slice(start + 1)) {
    if (el.tagName === "H1" || el.tagName === "H2") return null;
    if (el.tagName === "CODE") return el.closest("pre") ?? el;
    if (!/^H[3-6]$/.test(el.tagName)) return el;
  }
  return null;
}

function outlineStrip(outline: HTMLElement[]): HTMLElement {
  const strip = createEl("nav", { cls: "agents-inbox-outline", attr: { "aria-label": "Design outline" } });
  for (const heading of outline) {
    const entry = strip.createEl("button", { cls: "agents-inbox-outline-entry", text: (heading.textContent ?? "").trim() });
    entry.onclick = () => heading.scrollIntoView({ block: "start" });
  }
  return strip;
}

function outsideEmbeds(el: HTMLElement): boolean {
  return el.closest(".internal-embed") === null;
}

function headingsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].filter(outsideEmbeds);
}

function headingText(heading: HTMLElement): string {
  return (heading.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findHeading(root: HTMLElement, targets: string[]): HTMLElement | null {
  const headings = headingsOf(root);
  let found: HTMLElement | null = null;
  let from = 0;
  for (const target of targets) {
    const at = headings.findIndex((heading, index) => index >= from && headingText(heading) === target);
    if (at === -1) return null;
    found = headings[at];
    from = at + 1;
  }
  return found;
}

function tableRowsUnder(root: HTMLElement, heading: HTMLElement): HTMLElement[] {
  const blocks = [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, table")].filter(outsideEmbeds);
  const start = blocks.indexOf(heading);
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
