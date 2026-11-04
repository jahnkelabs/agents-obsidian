import { ItemView, MarkdownRenderer, Notice, type WorkspaceLeaf } from "obsidian";
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
  private timer: number | null = null;

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
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  refresh(): Promise<void> {
    if (this.timer !== null) return Promise.resolve();
    return new Promise((resolve) => {
      this.timer = window.setTimeout(async () => {
        this.timer = null;
        await this.render();
        resolve();
      }, REFRESH_DELAY_MS);
    });
  }

  private async render(): Promise<void> {
    const { groups, broken } = listAwaiting(this.docs);
    const root = this.contentEl;
    root.empty();
    root.addClass("agents-inbox");

    const shown = withHeld(groups, [...this.pending.values(), ...[...this.settled.values()].map((s) => s.entry)]);
    if (shown.length === 0 && broken.length === 0) {
      root.createDiv({ cls: "agents-inbox-empty", text: "Nothing waits on you." });
      return;
    }

    for (const { path, error } of broken) {
      const card = root.createDiv({ cls: "agents-inbox-card agents-inbox-broken" });
      card.createDiv({ cls: "agents-inbox-broken-path", text: path });
      card.createDiv({ cls: "agents-inbox-broken-error", text: error });
    }

    for (const group of shown) {
      const section = root.createDiv({ cls: "agents-inbox-group" });
      section.dataset.map = group.map ?? "";
      section.dataset.concern = group.concern ?? "";
      section.createEl("h4", { cls: "agents-inbox-group-title", text: groupTitle(group) });
      for (const entry of group.entries) await this.renderCard(section, entry);
    }
  }

  private async renderCard(parent: HTMLElement, entry: Entry): Promise<void> {
    const { item } = entry;
    const card = parent.createDiv({ cls: "agents-inbox-card" });
    card.dataset.id = entry.id;
    card.dataset.kind = item.kind;

    const body = card.createDiv({ cls: "agents-inbox-body" });
    await MarkdownRenderer.render(this.app, item.body, body, entry.path, this);

    const settled = this.settled.get(entry.id);
    if (settled) {
      card.createDiv({ cls: "agents-inbox-result", text: settled.message });
      const dismiss = card.createEl("button", { cls: "agents-inbox-dismiss", text: "Dismiss" });
      dismiss.onclick = () => {
        this.settled.delete(entry.id);
        void this.refresh();
      };
      return;
    }

    const busy = this.pending.has(entry.id);
    const note = card.createEl("textarea", { cls: "agents-inbox-note", attr: { placeholder: "Note" } });
    note.disabled = busy;

    const actions = card.createDiv({ cls: "agents-inbox-actions" });
    if (item.options.length > 0) {
      for (const option of item.options) {
        const button = actions.createEl("button", { cls: "agents-inbox-option", text: option });
        button.dataset.option = option;
        if (option === item.recommended) button.addClass("is-recommended", "mod-cta");
        button.disabled = busy;
        button.onclick = () => void this.submit(entry, option, note.value.trim() || null);
      }
    } else {
      const submit = actions.createEl("button", { cls: "agents-inbox-submit mod-cta", text: "Answer" });
      submit.disabled = true;
      note.oninput = () => (submit.disabled = busy || note.value.trim() === "");
      submit.onclick = () => {
        const text = note.value.trim();
        if (text !== "") void this.submit(entry, text, null);
      };
    }
  }

  private async submit(entry: Entry, answer: string, note: string | null): Promise<void> {
    this.pending.set(entry.id, entry);
    await this.render();
    try {
      const { won, item } = await answerItem(entry.path, { answer, note, answered_by: "inbox" });
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
