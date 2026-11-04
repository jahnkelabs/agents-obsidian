import { relative, sep } from "node:path";
import { Component, ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
import { answerItem } from "../store";
import { type Entry, type Group, listAwaiting } from "./inbox";

export const VIEW_TYPE = "agents-inbox";

const REFRESH_DELAY_MS = 16;

interface Settled {
  entry: Entry;
  message: string;
}

export class InboxView extends ItemView {
  private pending = new Map<string, Entry>();
  private settled = new Map<string, Settled>();
  private drafts = new Map<string, string>();
  private scheduled: { timer: number; done: Promise<void>; resolve: () => void } | null = null;
  private generation = 0;
  private rendered: Component | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly docs: string,
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
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.scheduled) {
      window.clearTimeout(this.scheduled.timer);
      this.scheduled.resolve();
      this.scheduled = null;
    }
    this.generation++;
  }

  refresh(): Promise<void> {
    if (this.scheduled) return this.scheduled.done;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const timer = window.setTimeout(() => {
      this.scheduled = null;
      this.settled.clear();
      void this.render().finally(resolve);
    }, REFRESH_DELAY_MS);
    this.scheduled = { timer, done, resolve };
    return done;
  }

  private async render(): Promise<void> {
    const generation = ++this.generation;
    const { groups, broken } = listAwaiting(this.docs);
    const held = [...this.pending.values(), ...[...this.settled.values()].map((s) => s.entry)];
    const shown = withHeld(groups, held);
    const component = new Component();
    const list = createFragment();

    for (const { path, error } of broken) {
      const card = list.createDiv({ cls: "agents-inbox-card agents-inbox-broken" });
      card.dataset.path = this.vaultPath(path);
      card.createDiv({ cls: "agents-inbox-broken-path", text: this.vaultPath(path) });
      card.createDiv({ cls: "agents-inbox-broken-error", text: error });
    }

    for (const group of shown) {
      const section = list.createDiv({ cls: "agents-inbox-group" });
      section.dataset.map = group.map ?? "";
      section.dataset.concern = group.concern ?? "";
      section.createEl("h4", { cls: "agents-inbox-group-title", text: groupTitle(group) });
      for (const entry of group.entries) await this.renderCard(section, entry, component);
    }

    if (shown.length === 0 && broken.length === 0) {
      list.createDiv({ cls: "agents-inbox-empty", text: "Nothing waits on you." });
    }

    if (generation !== this.generation) {
      component.unload();
      return;
    }
    const ids = new Set(shown.flatMap((g) => g.entries.map((e) => e.id)));
    for (const id of this.drafts.keys()) if (!ids.has(id)) this.drafts.delete(id);

    if (this.rendered) this.removeChild(this.rendered);
    this.rendered = this.addChild(component);
    this.contentEl.empty();
    this.contentEl.append(list);
  }

  private async renderCard(parent: HTMLElement, entry: Entry, component: Component): Promise<void> {
    const { item } = entry;
    const card = parent.createDiv({ cls: "agents-inbox-card" });
    card.dataset.id = entry.id;
    card.dataset.kind = item.kind;

    const body = card.createDiv({ cls: "agents-inbox-body" });
    await MarkdownRenderer.render(this.app, item.body, body, this.vaultPath(entry.path), component);

    const settled = this.settled.get(entry.id);
    if (settled) {
      card.addClass("is-settled");
      card.createDiv({ cls: "agents-inbox-result", text: settled.message });
      return;
    }

    const busy = this.pending.has(entry.id);
    card.toggleClass("is-busy", busy);
    const open = item.options.length === 0;
    const note = card.createEl("textarea", {
      cls: "agents-inbox-note",
      attr: { placeholder: open ? "Answer" : "Note" },
    });
    note.value = this.drafts.get(entry.id) ?? "";
    note.disabled = busy;

    const actions = card.createDiv({ cls: "agents-inbox-actions" });
    if (!open) {
      note.oninput = () => this.drafts.set(entry.id, note.value);
      for (const option of item.options) {
        const button = actions.createEl("button", { cls: "agents-inbox-option", text: option });
        button.dataset.option = option;
        if (option === item.recommended) button.addClass("is-recommended", "mod-cta");
        button.disabled = busy;
        button.onclick = () => void this.submit(entry, option, note.value.trim() || null);
      }
      return;
    }

    const submit = actions.createEl("button", { cls: "agents-inbox-submit mod-cta", text: "Answer" });
    const sync = () => (submit.disabled = busy || note.value.trim() === "");
    sync();
    note.oninput = () => {
      this.drafts.set(entry.id, note.value);
      sync();
    };
    submit.onclick = () => {
      const text = note.value.trim();
      if (text !== "") void this.submit(entry, text, null);
    };
  }

  private async submit(entry: Entry, answer: string, note: string | null): Promise<void> {
    if (this.pending.has(entry.id)) return;
    this.pending.set(entry.id, entry);
    await this.render();
    try {
      const { won, item } = await answerItem(entry.path, { answer, note, answered_by: "inbox" });
      this.drafts.delete(entry.id);
      if (!won) {
        const message = `Already answered by ${item.answered_by}: ${item.answer}`;
        this.settled.set(entry.id, { entry: { ...entry, item }, message });
      }
    } catch (error) {
      new Notice(`Inbox: ${(error as Error).message}`);
    } finally {
      this.pending.delete(entry.id);
      await this.render();
    }
  }

  private vaultPath(path: string): string {
    return relative(this.docs, path).split(sep).join("/");
  }
}

function groupTitle(group: Group): string {
  if (group.map === null) return "No map";
  return group.concern === null ? group.map : `${group.map} / ${group.concern}`;
}

function withHeld(groups: Group[], held: Entry[]): Group[] {
  const listed = new Set(groups.flatMap((g) => g.entries.map((e) => e.id)));
  const missing = held.filter((e) => !listed.has(e.id));
  if (missing.length === 0) return groups;
  const result = groups.map((g) => ({ ...g, entries: [...g.entries] }));
  for (const entry of missing) {
    const { map, concern } = entry.item;
    let target = result.find((g) => g.map === map && g.concern === concern);
    if (!target) result.push((target = { map, concern, entries: [] }));
    target.entries.push(entry);
  }
  return result;
}
