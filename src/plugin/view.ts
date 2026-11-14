import { ItemView, type WorkspaceLeaf } from "obsidian";
import { age, type Broken, type Entry, type Group, groupKey, listAwaiting, title, unread } from "./inbox";
import type AgentsPlugin from "./main";

export const VIEW_TYPE = "agents-inbox";

const REFRESH_DELAY_MS = 16;
const AGE_INTERVAL_MS = 60_000;

interface Row {
  el: HTMLElement;
  key: string;
  age: HTMLElement;
  created: string;
}

interface Section {
  el: HTMLElement;
  title: HTMLElement;
}

export class InboxView extends ItemView {
  private rows = new Map<string, Row>();
  private sections = new Map<string, Section>();
  private brokenRows = new Map<string, HTMLElement>();
  private readonly empty = createDiv({ cls: "agents-inbox-empty", text: "Nothing waits on you." });
  private timer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AgentsPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Inbox";
  }

  getIcon(): string {
    return "inbox";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("agents-inbox");
    this.registerInterval(window.setInterval(() => this.updateAges(), AGE_INTERVAL_MS));
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  refresh(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.render();
    }, REFRESH_DELAY_MS);
  }

  private render(): void {
    const { groups, broken } = listAwaiting(this.plugin.docs);
    const entries = groups.flatMap((g) => g.entries);

    const ids = new Set(entries.map((e) => e.id));
    for (const id of this.rows.keys()) if (!ids.has(id)) this.rows.delete(id);
    for (const entry of entries) {
      const path = this.plugin.vaultPath(entry.path);
      const isUnread = unread(entry, this.plugin.seenAt(path));
      const key = JSON.stringify([path, title(entry.item), entry.item.kind, entry.item.created_at, isUnread]);
      if (this.rows.get(entry.id)?.key !== key) this.rows.set(entry.id, this.buildRow(entry, path, key, isUnread));
    }
    this.updateAges();

    const isEmpty = groups.length === 0 && broken.length === 0;
    place(this.contentEl, [...this.placeBroken(broken), ...this.placeGroups(groups), ...(isEmpty ? [this.empty] : [])]);
  }

  private updateAges(): void {
    const now = Date.now();
    for (const row of this.rows.values()) row.age.setText(age(row.created, now));
  }

  private buildRow(entry: Entry, path: string, key: string, isUnread: boolean): Row {
    const el = createDiv({ cls: "agents-inbox-row" });
    el.dataset.id = entry.id;
    el.dataset.path = path;
    el.tabIndex = 0;
    el.toggleClass("is-unread", isUnread);
    if (isUnread) el.createSpan({ cls: "agents-inbox-unread", attr: { "aria-label": "Unread reply" } });
    el.createSpan({ cls: "agents-inbox-row-title", text: title(entry.item) });
    el.createSpan({ cls: "agents-inbox-row-kind", text: entry.item.kind });
    const ageEl = el.createSpan({ cls: "agents-inbox-row-age" });
    el.onclick = () => void this.plugin.openItem(path);
    el.onkeydown = (event) => {
      if (event.key === "Enter") void this.plugin.openItem(path);
    };
    return { el, key, age: ageEl, created: entry.item.created_at };
  }

  private placeBroken(broken: Broken[]): HTMLElement[] {
    const next = new Map<string, HTMLElement>();
    for (const { path, error } of broken) {
      const key = `${path}\u0000${error}`;
      next.set(key, this.brokenRows.get(key) ?? this.brokenRow(path, error));
    }
    this.brokenRows = next;
    return [...next.values()];
  }

  private brokenRow(path: string, error: string): HTMLElement {
    const row = createDiv({ cls: "agents-inbox-row agents-inbox-broken" });
    row.dataset.path = this.plugin.vaultPath(path);
    row.createDiv({ cls: "agents-inbox-broken-path", text: this.plugin.vaultPath(path) });
    row.createDiv({ cls: "agents-inbox-broken-error", text: error });
    return row;
  }

  private placeGroups(shown: Group[]): HTMLElement[] {
    const next = new Map<string, Section>();
    for (const g of shown) {
      const key = groupKey(g);
      const section = this.sections.get(key) ?? newSection(g);
      next.set(key, section);
      place(section.el, [section.title, ...g.entries.flatMap((e) => this.rows.get(e.id)?.el ?? [])]);
    }
    this.sections = next;
    return [...next.values()].map((s) => s.el);
  }
}

function groupTitle(g: Group): string {
  if (g.map === null) return "No map";
  return g.concern === null ? g.map : `${g.map} / ${g.concern}`;
}

function newSection(g: Group): Section {
  const el = createDiv({ cls: "agents-inbox-group" });
  el.dataset.map = g.map ?? "";
  el.dataset.concern = g.concern ?? "";
  const title = el.createEl("h4", { cls: "agents-inbox-group-title", text: groupTitle(g) });
  return { el, title };
}

export function place(parent: HTMLElement, nodes: HTMLElement[]): void {
  const keep = new Set<Element>(nodes);
  for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
  nodes.forEach((node, index) => {
    const at = parent.children.item(index);
    if (at !== node) parent.insertBefore(node, at);
  });
}
