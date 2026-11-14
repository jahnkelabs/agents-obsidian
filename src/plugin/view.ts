import { join, relative, sep } from "node:path";
import { Component, ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
import { answerItem } from "../store";
import { type Broken, type Entry, type Group, group, groupKey, inboxMtimes, listAwaiting, mtimeOf } from "./inbox";

export const VIEW_TYPE = "agents-inbox";

const REFRESH_DELAY_MS = 16;

interface Settled {
  entry: Entry;
  message: string;
  mtimes: Map<string, number>;
}

interface Card {
  el: HTMLElement;
  key: string;
  component: Component;
  setBusy: (busy: boolean) => void;
}

interface Section {
  el: HTMLElement;
  title: HTMLElement;
}

export class InboxView extends ItemView {
  private pending = new Map<string, Entry>();
  private settled = new Map<string, Settled>();
  private changed = new Set<string>();
  private cards = new Map<string, Card>();
  private sections = new Map<string, Section>();
  private brokenCards = new Map<string, HTMLElement>();
  private readonly empty = createDiv({ cls: "agents-inbox-empty", text: "Nothing waits on you." });
  private scheduled: { timer: number; done: Promise<void>; resolve: () => void } | null = null;
  private generation = 0;

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

  refresh(vaultPath?: string): Promise<void> {
    if (vaultPath !== undefined) this.changed.add(vaultPath);
    if (this.scheduled) return this.scheduled.done;
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const timer = window.setTimeout(() => {
      this.scheduled = null;
      this.releaseSettled();
      void this.render().finally(resolve);
    }, REFRESH_DELAY_MS);
    this.scheduled = { timer, done, resolve };
    return done;
  }

  private releaseSettled(): void {
    const changed = [...this.changed].map((path) => join(this.docs, path));
    this.changed.clear();
    for (const [id, { mtimes }] of this.settled) {
      if (changed.some((path) => !mtimes.has(path) || mtimeOf(path) !== mtimes.get(path))) this.settled.delete(id);
    }
  }

  private held(): Entry[] {
    const held = new Map(this.pending);
    for (const [id, { entry }] of this.settled) held.set(id, entry);
    return [...held.values()];
  }

  private async render(): Promise<void> {
    const generation = ++this.generation;
    const { groups, broken } = listAwaiting(this.docs);
    const shown = withHeld(groups, this.held());
    const entries = shown.flatMap((g) => g.entries);

    const built = new Map<string, Card>();
    for (const entry of entries) {
      const key = JSON.stringify(entry.item);
      if (this.cards.get(entry.id)?.key !== key) built.set(entry.id, await this.buildCard(entry, key));
    }

    if (generation !== this.generation) {
      for (const card of built.values()) card.component.unload();
      return;
    }

    const ids = new Set(entries.map((e) => e.id));
    for (const [id, card] of this.cards) {
      if (ids.has(id) && !built.has(id)) continue;
      this.removeChild(card.component);
      card.el.remove();
      this.cards.delete(id);
    }
    for (const [id, card] of built) {
      this.addChild(card.component);
      this.cards.set(id, card);
    }
    for (const entry of entries) this.cards.get(entry.id)?.setBusy(this.pending.has(entry.id));

    const isEmpty = shown.length === 0 && broken.length === 0;
    place(this.contentEl, [...this.placeBroken(broken), ...this.placeGroups(shown), ...(isEmpty ? [this.empty] : [])]);
  }

  private placeBroken(broken: Broken[]): HTMLElement[] {
    const next = new Map<string, HTMLElement>();
    for (const { path, error } of broken) {
      const key = `${path}\u0000${error}`;
      next.set(key, this.brokenCards.get(key) ?? this.brokenCard(path, error));
    }
    this.brokenCards = next;
    return [...next.values()];
  }

  private brokenCard(path: string, error: string): HTMLElement {
    const card = createDiv({ cls: "agents-inbox-card agents-inbox-broken" });
    card.dataset.path = this.vaultPath(path);
    card.createDiv({ cls: "agents-inbox-broken-path", text: this.vaultPath(path) });
    card.createDiv({ cls: "agents-inbox-broken-error", text: error });
    return card;
  }

  private placeGroups(shown: Group[]): HTMLElement[] {
    const next = new Map<string, Section>();
    for (const g of shown) {
      const key = groupKey(g);
      const section = this.sections.get(key) ?? newSection(g);
      next.set(key, section);
      place(section.el, [section.title, ...g.entries.flatMap((e) => this.cards.get(e.id)?.el ?? [])]);
    }
    this.sections = next;
    return [...next.values()].map((s) => s.el);
  }

  private async buildCard(entry: Entry, key: string): Promise<Card> {
    const { item } = entry;
    const component = new Component();
    const el = createDiv({ cls: "agents-inbox-card" });
    el.dataset.id = entry.id;
    el.dataset.kind = item.kind;

    const body = el.createDiv({ cls: "agents-inbox-body" });
    await MarkdownRenderer.render(this.app, item.body, body, this.vaultPath(entry.path), component);

    const settled = this.settled.get(entry.id);
    if (settled) {
      el.addClass("is-settled");
      el.createDiv({ cls: "agents-inbox-result", text: settled.message });
      return { el, key, component, setBusy: () => {} };
    }

    const open = item.options.length === 0;
    const note = el.createEl("textarea", {
      cls: "agents-inbox-note",
      attr: { placeholder: open ? "Answer" : "Note" },
    });
    const actions = el.createDiv({ cls: "agents-inbox-actions" });

    if (!open) {
      const buttons = item.options.map((option) => {
        const button = actions.createEl("button", { cls: "agents-inbox-option", text: option });
        button.dataset.option = option;
        if (option === item.recommended) button.addClass("is-recommended", "mod-cta");
        button.onclick = () => void this.submit(entry, option, note.value.trim() || null);
        return button;
      });
      const setBusy = (busy: boolean) => {
        el.toggleClass("is-busy", busy);
        note.disabled = busy;
        for (const button of buttons) button.disabled = busy;
      };
      return { el, key, component, setBusy };
    }

    const submit = actions.createEl("button", { cls: "agents-inbox-submit mod-cta", text: "Answer" });
    let busy = false;
    const sync = () => (submit.disabled = busy || note.value.trim() === "");
    note.oninput = sync;
    submit.onclick = () => {
      const text = note.value.trim();
      if (text !== "") void this.submit(entry, text, null);
    };
    const setBusy = (next: boolean) => {
      busy = next;
      el.toggleClass("is-busy", busy);
      note.disabled = busy;
      sync();
    };
    return { el, key, component, setBusy };
  }

  private async submit(entry: Entry, answer: string, note: string | null): Promise<void> {
    if (this.pending.has(entry.id)) return;
    this.pending.set(entry.id, entry);
    await this.render();
    try {
      const { won, item } = await answerItem(entry.path, { answer, note, answered_by: "inbox" });
      if (!won) {
        const message = `Already answered by ${item.answered_by}: ${item.answer}`;
        this.settled.set(entry.id, { entry: { ...entry, item }, message, mtimes: inboxMtimes(this.docs) });
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

function withHeld(groups: Group[], held: Entry[]): Group[] {
  const listed = groups.flatMap((g) => g.entries);
  const ids = new Set(listed.map((e) => e.id));
  const missing = held.filter((e) => !ids.has(e.id));
  return missing.length === 0 ? groups : group([...listed, ...missing]);
}

function place(parent: HTMLElement, nodes: HTMLElement[]): void {
  const keep = new Set<Element>(nodes);
  for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
  nodes.forEach((node, index) => {
    const at = parent.children.item(index);
    if (at !== node) parent.insertBefore(node, at);
  });
}
