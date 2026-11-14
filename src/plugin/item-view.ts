import { basename, join } from "node:path";
import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  Platform,
  Scope,
  setIcon,
  setTooltip,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { Item, Message } from "../schema";
import { answerItem, appendMessage, readItem } from "../store";
import { age, answerText, title } from "./inbox";
import type AgentsPlugin from "./main";
import { place } from "./view";

export const ITEM_VIEW_TYPE = "agents-inbox-item";

const REFRESH_DELAY_MS = 16;

type Loaded = { kind: "item"; item: Item } | { kind: "missing" } | { kind: "broken"; error: string };

interface Rendered {
  key: string;
  el: HTMLElement;
  component: Component;
}

interface AnswerSection {
  key: string;
  el: HTMLElement;
  sync: () => void;
}

function ago(at: string): string {
  const span = age(at, Date.now());
  return span === "now" ? "just now" : `${span} ago`;
}

export class InboxItemView extends ItemView {
  path = "";
  private item: Item | null = null;
  private busy = false;
  private closed = false;
  private scheduled: Promise<void> | null = null;
  private queue: Promise<void> = Promise.resolve();

  private readonly mainEl = createDiv({ cls: "agents-inbox-item-main" });
  private readonly dockEl = createDiv({ cls: "agents-inbox-dock" });
  private readonly metaEl = createDiv({ cls: "agents-inbox-item-meta" });
  private readonly bodyEl = createDiv({ cls: "agents-inbox-body markdown-rendered" });
  private body: Rendered | null = null;
  private readonly threadEl = createDiv({ cls: "agents-inbox-thread" });
  private messages: Rendered[] = [];
  private readonly waitingEl = createDiv({ cls: "agents-inbox-waiting" });
  private readonly statusEl = createDiv({ cls: "agents-inbox-status" });
  private readonly notSentEl = createDiv({ cls: "agents-inbox-not-sent" });
  private readonly composeEl = createDiv({ cls: "agents-inbox-compose" });
  private readonly composer = this.composeEl.createEl("textarea", {
    cls: "agents-inbox-composer",
    attr: { placeholder: "Ask the agent a question…", rows: "2", "aria-label": "Message the agent" },
  });
  private readonly hint = this.composeEl.createSpan({
    cls: "agents-inbox-compose-hint",
    text: Platform.isMacOS ? "⌘↵ to send" : "Ctrl+↵ to send",
  });
  private readonly send = this.composeEl.createEl("button", { cls: "agents-inbox-send", attr: { "aria-label": "Send" } });
  private readonly copyDraft = createEl("button", { cls: "agents-inbox-copy-draft", text: "Copy draft" });
  private answerSection: AnswerSection | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AgentsPlugin,
  ) {
    super(leaf);
    setIcon(this.send, "arrow-up");
    setIcon(this.waitingEl.createSpan({ cls: "agents-inbox-waiting-icon" }), "clock");
    this.waitingEl.createSpan({ text: "Waiting for the agent to reply" });
    setIcon(this.notSentEl.createSpan({ cls: "agents-inbox-not-sent-icon" }), "alert-circle");
    this.notSentEl.createSpan({ text: "Not sent: the item was answered while you typed. Copy your draft if you need it." });
    this.composer.oninput = () => this.sync();
    this.send.onclick = () => void this.sendMessage();
    this.copyDraft.onclick = () => void this.copy();
    this.scope = new Scope(this.app.scope);
    for (const modifier of ["Mod", "Ctrl"] as const) {
      this.scope.register([modifier], "Enter", (event) => {
        if (event.target !== this.composer) return;
        void this.sendMessage();
        return false;
      });
    }
  }

  getViewType(): string {
    return ITEM_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.item ? title(this.item) : "Inbox item";
  }

  getIcon(): string {
    return "inbox";
  }

  getState(): Record<string, unknown> {
    return { path: this.path };
  }

  async setState(state: { path: string }, result: ViewStateResult): Promise<void> {
    if (state.path !== this.path) {
      this.clear();
      this.composer.value = "";
      this.path = state.path;
      this.contentEl.dataset.path = this.path;
      this.contentEl.dataset.id = basename(this.path, ".md");
    }
    await super.setState(state, result);
    await this.refresh();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("agents-inbox-item");
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.see();
      }),
    );
  }

  async onClose(): Promise<void> {
    this.closed = true;
  }

  onResize(): void {
    this.see();
  }

  refresh(vaultPath?: string): Promise<void> {
    if (vaultPath !== undefined && vaultPath !== this.path) return Promise.resolve();
    this.scheduled ??= new Promise<void>((resolve) => window.setTimeout(resolve, REFRESH_DELAY_MS)).then(() => {
      this.scheduled = null;
      this.queue = this.queue
        .then(() => this.render())
        .catch((error) => {
          new Notice(`Inbox: ${(error as Error).message}`);
        });
      return this.queue;
    });
    return this.scheduled;
  }

  private absolute(): string {
    return join(this.plugin.docs, this.path);
  }

  private readState(): Loaded {
    try {
      return { kind: "item", item: readItem(this.absolute()) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      return { kind: "broken", error: (error as Error).message };
    }
  }

  private async render(): Promise<void> {
    if (this.closed || this.path === "") return;
    const loaded = this.readState();
    if (loaded.kind !== "item") {
      this.item = null;
      this.clear();
      this.statusEl.empty();
      if (loaded.kind === "missing") this.statusEl.createDiv({ cls: "agents-inbox-missing", text: "This item no longer exists" });
      else this.statusEl.createDiv({ cls: "agents-inbox-broken-error", text: loaded.error });
      place(this.mainEl, [this.statusEl]);
      place(this.contentEl, [this.mainEl]);
      return;
    }

    const { item } = loaded;
    this.item = item;
    const awaiting = item.status === "awaiting-you";
    this.contentEl.dataset.status = item.status;
    this.renderMeta(item);

    if (awaiting) {
      this.statusEl.empty();
      const key = JSON.stringify([item.select, item.options, item.recommended]);
      if (this.answerSection?.key !== key) this.answerSection = this.buildAnswer(item, key);
    } else {
      this.showAnswered(item);
      this.answerSection = null;
    }
    const draft = this.composer.value.trim() !== "";
    const last = item.thread[item.thread.length - 1];
    const waiting = awaiting && last?.author === "you";
    this.composeEl.toggleClass("is-draft", !awaiting);
    place(this.composeEl, awaiting ? [this.composer, this.hint, this.send] : [this.composer, this.copyDraft]);
    place(this.mainEl, [
      this.metaEl,
      this.bodyEl,
      this.threadEl,
      ...(waiting ? [this.waitingEl] : []),
      ...(awaiting ? [] : [this.statusEl]),
    ]);
    const docked = awaiting
      ? [...(this.answerSection ? [this.answerSection.el] : []), this.composeEl]
      : draft
        ? [this.notSentEl, this.composeEl]
        : [];
    place(this.dockEl, docked);
    place(this.contentEl, [this.mainEl, ...(docked.length > 0 ? [this.dockEl] : [])]);
    this.sync();

    await this.renderBody(item);
    await this.renderThread(item.thread);
    this.see();
  }

  private renderMeta(item: Item): void {
    this.metaEl.empty();
    this.metaEl.createSpan({ cls: `agents-inbox-kind agents-inbox-kind-${item.kind}`, text: item.kind });
    const where = item.map === null ? null : item.concern === null ? item.map : `${item.map} / ${item.concern}`;
    for (const part of [where, item.from, ago(item.created_at)]) {
      if (part === null) continue;
      this.metaEl.createSpan({ cls: "agents-inbox-sep", text: "·", attr: { "aria-hidden": "true" } });
      this.metaEl.createSpan({ text: part });
    }
  }

  private showAnswered(item: Item): void {
    this.statusEl.empty();
    const card = this.statusEl.createDiv({ cls: "agents-inbox-answered" });
    const head = card.createDiv({ cls: "agents-inbox-answered-head" });
    setIcon(head.createSpan({ cls: "agents-inbox-answered-icon" }), "check");
    head.createSpan({ cls: "agents-inbox-result", text: `Answered by ${item.answered_by}: ${answerText(item)}` });
    if (item.answered_at !== null) {
      head.createSpan({ cls: "agents-inbox-sep", text: "·", attr: { "aria-hidden": "true" } });
      head.createSpan({ cls: "agents-inbox-answered-age", text: ago(item.answered_at) });
    }
    if (item.note !== null) card.createDiv({ cls: "agents-inbox-result-note", text: `Note: ${item.note}` });
  }

  private clear(): void {
    if (this.body) this.removeChild(this.body.component);
    this.body = null;
    this.bodyEl.empty();
    for (const message of this.messages) this.removeChild(message.component);
    this.messages = [];
    this.threadEl.empty();
    this.answerSection = null;
  }

  private async renderBody(item: Item): Promise<void> {
    if (this.body?.key === item.body) return;
    if (this.body) this.removeChild(this.body.component);
    this.bodyEl.empty();
    const component = this.addChild(new Component());
    this.body = { key: item.body, el: this.bodyEl, component };
    await MarkdownRenderer.render(this.app, item.body, this.bodyEl, this.path, component);
    const first = this.bodyEl.firstElementChild;
    if (first instanceof HTMLElement && first.textContent?.trim() === title(item)) first.addClass("agents-inbox-item-title");
  }

  private async renderThread(thread: Message[]): Promise<void> {
    const keys = thread.map((message) => JSON.stringify(message));
    let kept = 0;
    while (kept < this.messages.length && this.messages[kept].key === keys[kept]) kept++;
    for (const stale of this.messages.splice(kept)) {
      this.removeChild(stale.component);
      stale.el.remove();
    }
    for (let index = kept; index < thread.length; index++) {
      this.messages.push(await this.renderMessage(thread[index], keys[index]));
    }
  }

  private async renderMessage(message: Message, key: string): Promise<Rendered> {
    const el = this.threadEl.createDiv({ cls: "agents-inbox-message" });
    el.dataset.author = message.author;
    const at = new Date(message.at).toLocaleString();
    if (message.author === "agent") {
      const label = el.createDiv({ cls: "agents-inbox-message-author" });
      label.createSpan({ cls: "agents-inbox-message-dot" });
      label.createSpan({ text: "agent" });
      setTooltip(label, at);
    } else {
      setTooltip(el, at, { placement: "left" });
    }
    const text = el.createDiv({ cls: "agents-inbox-message-text markdown-rendered" });
    const component = this.addChild(new Component());
    await MarkdownRenderer.render(this.app, message.text, text, this.path, component);
    return { key, el, component };
  }

  private buildAnswer(item: Item, key: string): AnswerSection {
    const el = createDiv({ cls: "agents-inbox-answer-section" });
    const open = item.options.length === 0;
    const many = item.select === "many";
    const recommended = item.recommended === null ? [] : [item.recommended].flat();

    el.createDiv({
      cls: "agents-inbox-answer-label",
      text: `Your answer · ${open ? "open question" : many ? "pick any" : "pick one"}`,
    });
    const choices = el.createDiv({ cls: "agents-inbox-choices" });
    const inputs = item.options.map((option) => {
      const label = choices.createEl("label", { cls: "agents-inbox-choice" });
      label.dataset.option = option;
      const control = label.createSpan({ cls: "agents-inbox-choice-control" });
      const input = control.createEl("input", { type: many ? "checkbox" : "radio", attr: { name: `agents-inbox-${this.path}`, value: option } });
      const text = label.createSpan({ cls: "agents-inbox-choice-text" });
      text.createSpan({ cls: "agents-inbox-choice-label", text: option });
      if (recommended.includes(option)) {
        label.addClass("is-recommended");
        text.createSpan({ cls: "agents-inbox-recommended", text: "recommended" });
      }
      return input;
    });
    const row = el.createDiv({ cls: "agents-inbox-answer-row" });
    const note = row.createEl("textarea", {
      cls: "agents-inbox-note",
      attr: { rows: "1", placeholder: open ? "Your answer" : "Add a note (optional)", "aria-label": open ? "Answer" : "Note" },
    });
    const submit = row.createEl("button", { cls: "agents-inbox-answer mod-cta", text: "Answer" });

    const chosen = (): string | string[] | null => {
      if (open) return note.value.trim() || null;
      const picked = inputs.filter((input) => input.checked).map((input) => input.value);
      if (many) return picked.length > 0 ? picked : null;
      return picked[0] ?? null;
    };
    const sync = () => {
      for (const input of inputs) input.disabled = this.busy;
      note.disabled = this.busy;
      submit.disabled = this.busy || chosen() === null;
    };
    for (const input of inputs) input.onchange = sync;
    note.oninput = sync;
    submit.onclick = () => {
      const answer = chosen();
      if (answer !== null) void this.answer(answer, open ? null : note.value.trim() || null);
    };
    return { key, el, sync };
  }

  private sync(): void {
    const awaiting = this.item?.status === "awaiting-you";
    this.contentEl.toggleClass("is-busy", this.busy);
    this.composer.readOnly = this.busy || !awaiting;
    this.send.disabled = this.busy || !awaiting || this.composer.value.trim() === "";
    this.answerSection?.sync();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.sync();
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.composer.value);
      new Notice("Draft copied");
    } catch (error) {
      new Notice(`Inbox: ${(error as Error).message}`);
    }
  }

  private async sendMessage(): Promise<void> {
    const text = this.composer.value.replace(/\s+$/, "");
    if (this.busy || text.trim() === "" || this.item?.status !== "awaiting-you") return;
    this.setBusy(true);
    try {
      const { appended } = await appendMessage(this.absolute(), { author: "you", text });
      if (appended) this.composer.value = "";
    } catch (error) {
      new Notice(`Inbox: ${(error as Error).message}`);
    } finally {
      this.setBusy(false);
      await this.refresh();
    }
  }

  private async answer(answer: string | string[], note: string | null): Promise<void> {
    if (this.busy) return;
    this.setBusy(true);
    try {
      await answerItem(this.absolute(), { answer, note, answered_by: "inbox" });
    } catch (error) {
      new Notice(`Inbox: ${(error as Error).message}`);
    } finally {
      this.setBusy(false);
      await this.refresh();
    }
  }

  private see(): void {
    if (this.item === null || !this.containerEl.isShown()) return;
    void this.plugin.markSeen({ id: basename(this.path, ".md"), path: this.absolute(), item: this.item });
  }
}
