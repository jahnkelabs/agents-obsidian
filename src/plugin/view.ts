import { ItemView, Menu, SearchComponent, setIcon, type WorkspaceLeaf } from "obsidian";
import { type Kind, KINDS } from "../schema";
import { age, type Broken, type Entry, listAwaiting, title, unread } from "./inbox";
import { place, REFRESH_DELAY_MS } from "./dom";
import { ITEM_VIEW_TYPE } from "./item-view";
import type AgentsPlugin from "./main";
import { type Filters, type GroupBy, type Match, organize, type Shown, type Sort, type StateFilter } from "./organize";

export const VIEW_TYPE = "agents-inbox";

export const GROUP_BY: Record<GroupBy, string> = {
  concern: "Map and concern",
  map: "Map",
  kind: "Kind",
  age: "Age",
  none: "None",
};

export const SORT: Record<Sort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  activity: "Latest activity",
};

const STATE: Record<StateFilter, { menu: string; chip: string }> = {
  "new-reply": { menu: "New reply from the agent", chip: "new reply" },
  "waiting-on-agent": { menu: "Waiting on the agent", chip: "waiting on agent" },
};

const AGE_INTERVAL_MS = 60_000;

type FilterSection = keyof Filters;

interface Row {
  el: HTMLElement;
  key: string;
  age: HTMLElement;
  created: string;
}

interface Section {
  el: HTMLElement;
  title: HTMLElement | null;
}

export class InboxView extends ItemView {
  private entries: Entry[] = [];
  private broken: Broken[] = [];
  private query = "";
  private readonly filters: Filters = { state: new Set(), kind: new Set(), map: new Set() };
  private counts: Shown["counts"] | null = null;

  private rows = new Map<string, Row>();
  private sections = new Map<string, Section>();
  private brokenRows = new Map<string, HTMLElement>();
  private timer: number | null = null;

  private readonly toolbar = createDiv({ cls: "agents-inbox-toolbar" });
  private readonly headerCount: HTMLElement;
  private readonly search: SearchComponent;
  private readonly filterButton: HTMLElement;
  private readonly groupButton: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly listEl = createDiv({ cls: "agents-inbox" });
  private readonly empty = createDiv({ cls: "agents-inbox-empty" });
  private readonly noMatch = createDiv({ cls: "agents-inbox-no-match" });
  private readonly noMatchHint: HTMLElement;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: AgentsPlugin,
  ) {
    super(leaf);
    const header = this.toolbar.createDiv({ cls: "agents-inbox-header" });
    header.createSpan({ cls: "agents-inbox-header-title", text: "Inbox" });
    this.headerCount = header.createSpan({ cls: "agents-inbox-header-count" });

    const controls = this.toolbar.createDiv({ cls: "agents-inbox-controls" });
    this.search = new SearchComponent(controls).setPlaceholder("Search…").onChange((value) => {
      this.query = value;
      this.draw();
    });
    this.search.inputEl.setAttribute("aria-label", "Search the inbox");
    this.filterButton = iconButton(controls, "agents-inbox-filter-button", "filter", "Filter", () => this.filterMenu());
    this.groupButton = iconButton(controls, "agents-inbox-group-button", "arrow-up-narrow-wide", "Group and sort", () => this.groupMenu());
    this.chips = this.toolbar.createDiv({ cls: "agents-inbox-chips" });

    setIcon(this.empty.createDiv({ cls: "agents-inbox-empty-icon" }), "check");
    this.empty.createDiv({ cls: "agents-inbox-empty-title", text: "Nothing waits on you" });
    this.empty.createDiv({ cls: "agents-inbox-empty-hint", text: "Agents' questions appear here." });

    this.noMatch.createDiv({ cls: "agents-inbox-no-match-title", text: "No items match" });
    this.noMatchHint = this.noMatch.createDiv({ cls: "agents-inbox-no-match-hint" });
    const clear = this.noMatch.createEl("button", { cls: "agents-inbox-clear", text: "Clear search and filters" });
    clear.onclick = () => this.clearAll();
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
    this.contentEl.addClass("agents-inbox-view");
    place(this.contentEl, [this.toolbar, this.listEl]);
    this.registerInterval(window.setInterval(() => this.updateAges(), AGE_INTERVAL_MS));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.select()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.select()));
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
    const { entries, broken } = listAwaiting(this.plugin.docs);
    this.entries = entries;
    this.broken = broken;
    this.draw();
  }

  private draw(): void {
    const { groupBy, sort } = this.plugin.sidebar;
    const shown = organize(this.entries, { query: this.query, filters: this.filters, groupBy, sort }, (entry) => this.isUnread(entry), Date.now());
    this.counts = shown.counts;
    const located = groupBy !== "concern" && groupBy !== "map";

    const matches = shown.groups.flatMap((g) => g.entries);
    const ids = new Set(matches.map((match) => match.entry.id));
    for (const id of this.rows.keys()) if (!ids.has(id)) this.rows.delete(id);
    for (const match of matches) {
      const { item } = match.entry;
      const path = this.plugin.vaultPath(match.entry.path);
      const location = located ? [item.map, item.concern] : null;
      const key = JSON.stringify([path, title(item), item.kind, item.created_at, match.unread, location, match.snippet]);
      if (this.rows.get(match.entry.id)?.key !== key) this.rows.set(match.entry.id, this.buildRow(match, path, key, located));
    }
    this.updateAges();

    const narrowed = this.narrowed();
    this.headerCount.setText(narrowed ? `${shown.shown} of ${shown.waiting}` : `${shown.waiting}`);
    this.filterButton.toggleClass("is-active", this.filtering());
    this.drawChips();

    const groups = this.placeGroups(shown.groups, groupBy);
    let state: HTMLElement[] = [];
    if (shown.waiting === 0 && this.broken.length === 0) state = [this.empty];
    else if (shown.waiting > 0 && shown.shown === 0) {
      this.noMatchHint.setText(`${shown.waiting} ${shown.waiting === 1 ? "item is" : "items are"} hidden by your search and filters.`);
      state = [this.noMatch];
    }
    place(this.listEl, [...this.placeBroken(this.broken), ...groups, ...state]);
    this.select();
  }

  private isUnread(entry: Entry): boolean {
    return unread(entry, this.plugin.seenAt(this.plugin.vaultPath(entry.path)));
  }

  private filtering(): boolean {
    return this.filters.state.size + this.filters.kind.size + this.filters.map.size > 0;
  }

  private narrowed(): boolean {
    return this.query.trim() !== "" || this.filtering();
  }

  private select(): void {
    const leaf = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    const state = leaf?.view.getViewType() === ITEM_VIEW_TYPE ? leaf.getViewState().state : undefined;
    const path = typeof state?.path === "string" ? state.path : null;
    for (const row of this.rows.values()) row.el.toggleClass("is-selected", row.el.dataset.path === path);
  }

  private updateAges(): void {
    const now = Date.now();
    for (const row of this.rows.values()) row.age.setText(age(row.created, now));
  }

  private buildRow(match: Match, path: string, key: string, located: boolean): Row {
    const { entry, unread: isUnread, snippet } = match;
    const { item } = entry;
    const el = createDiv({ cls: "agents-inbox-row" });
    el.dataset.id = entry.id;
    el.dataset.path = path;
    el.tabIndex = 0;
    el.toggleClass("is-unread", isUnread);
    const head = el.createDiv({ cls: "agents-inbox-row-head" });
    if (isUnread) head.createSpan({ cls: "agents-inbox-unread", attr: { "aria-label": "Unread reply" } });
    head.createSpan({ cls: "agents-inbox-row-title", text: title(item) });
    if (snippet !== null) {
      const line = el.createDiv({ cls: "agents-inbox-row-snippet" });
      line.appendText(oneLine(snippet.before));
      line.createEl("mark", { text: oneLine(snippet.hit) });
      line.appendText(oneLine(snippet.after));
    }
    const meta = el.createDiv({ cls: "agents-inbox-row-meta" });
    if (located) {
      meta.createSpan({ cls: "agents-inbox-row-location", text: location(item.map, item.concern) });
      meta.createSpan({ cls: "agents-inbox-sep", text: "·", attr: { "aria-hidden": "true" } });
    }
    meta.createSpan({ cls: `agents-inbox-row-kind agents-inbox-kind-${item.kind}`, text: item.kind });
    meta.createSpan({ cls: "agents-inbox-sep", text: "·", attr: { "aria-hidden": "true" } });
    const ageEl = meta.createSpan({ cls: "agents-inbox-row-age" });
    if (isUnread) {
      meta.createSpan({ cls: "agents-inbox-sep", text: "·", attr: { "aria-hidden": "true" } });
      meta.createSpan({ cls: "agents-inbox-row-new", text: "new reply" });
    }
    el.onclick = () => void this.plugin.openItem(path);
    el.onkeydown = (event) => {
      if (event.key === "Enter") void this.plugin.openItem(path);
    };
    return { el, key, age: ageEl, created: item.created_at };
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
    const head = row.createDiv({ cls: "agents-inbox-broken-head" });
    setIcon(head.createSpan({ cls: "agents-inbox-broken-icon" }), "alert-circle");
    head.createSpan({ text: "Can't read this item" });
    row.createDiv({ cls: "agents-inbox-broken-path", text: this.plugin.vaultPath(path) });
    row.createDiv({ cls: "agents-inbox-broken-error", text: error });
    return row;
  }

  private placeGroups(groups: Shown["groups"], groupBy: GroupBy): HTMLElement[] {
    const next = new Map<string, Section>();
    for (const g of groups) {
      const section = this.sections.get(g.key) ?? newSection(g, groupBy);
      next.set(g.key, section);
      const rows = g.entries.flatMap((match) => this.rows.get(match.entry.id)?.el ?? []);
      place(section.el, section.title === null ? rows : [section.title, ...rows]);
    }
    this.sections = next;
    return [...next.values()].map((s) => s.el);
  }

  private drawChips(): void {
    const chips: HTMLElement[] = [];
    for (const section of ["state", "kind", "map"] as const) {
      const names = this.chosen(section);
      if (names.length === 0) continue;
      const chip = createDiv({ cls: "agents-inbox-chip" });
      chip.dataset.section = section;
      chip.createSpan({ cls: "agents-inbox-chip-label", text: `${section}: ${names.join(", ")}` });
      iconButton(chip, "agents-inbox-chip-remove", "x", `Remove the ${section} filter`, () => {
        this.filters[section].clear();
        this.draw();
      });
      chips.push(chip);
    }
    place(this.chips, chips);
  }

  private chosen(section: FilterSection): string[] {
    switch (section) {
      case "state":
        return stateChoices().flatMap((state) => (this.filters.state.has(state) ? [STATE[state].chip] : []));
      case "kind":
        return KINDS.filter((kind) => this.filters.kind.has(kind));
      case "map":
        return [...this.filters.map].sort(compareMaps).map((map) => map ?? "No map");
    }
  }

  private filterMenu(): void {
    const counts = this.counts;
    if (counts === null) return;
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem((item) => item.setTitle("State").setIsLabel(true));
    for (const state of stateChoices()) {
      addChoice(menu, STATE[state].menu, counts.state.get(state) ?? 0, this.filters.state.has(state), () => this.toggle(this.filters.state, state));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Kind").setIsLabel(true));
    for (const kind of KINDS) {
      addChoice(menu, kind, counts.kind.get(kind) ?? 0, this.filters.kind.has(kind), () => this.toggle<Kind>(this.filters.kind, kind));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Map").setIsLabel(true));
    const maps = [...new Set([...counts.map.keys(), ...this.filters.map])].sort(compareMaps);
    for (const map of maps) {
      addChoice(menu, map ?? "No map", counts.map.get(map) ?? 0, this.filters.map.has(map), () => this.toggle(this.filters.map, map));
    }
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(menuTitle("Clear all"))
        .setDisabled(!this.filtering())
        .onClick(() => this.clearFilters()),
    );
    showBelow(menu, this.filterButton);
  }

  private groupMenu(): void {
    const { groupBy, sort } = this.plugin.sidebar;
    const menu = new Menu().setUseNativeMenu(false);
    menu.addItem((item) => item.setTitle("Group by").setIsLabel(true));
    for (const [value, name] of Object.entries(GROUP_BY) as [GroupBy, string][]) {
      menu.addItem((item) =>
        item
          .setTitle(menuTitle(name))
          .setChecked(value === groupBy)
          .onClick(() => this.arrange({ groupBy: value, sort })),
      );
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Sort").setIsLabel(true));
    for (const [value, name] of Object.entries(SORT) as [Sort, string][]) {
      menu.addItem((item) =>
        item
          .setTitle(menuTitle(name))
          .setChecked(value === sort)
          .onClick(() => this.arrange({ groupBy, sort: value })),
      );
    }
    showBelow(menu, this.groupButton);
  }

  private arrange(sidebar: AgentsPlugin["sidebar"]): void {
    void this.plugin.saveSidebar(sidebar);
    this.draw();
  }

  private toggle<T>(set: Set<T>, value: T): void {
    if (!set.delete(value)) set.add(value);
    this.draw();
  }

  private clearFilters(): void {
    for (const set of Object.values(this.filters) as Set<unknown>[]) set.clear();
    this.draw();
  }

  private clearAll(): void {
    this.query = "";
    this.search.setValue("");
    this.clearFilters();
  }
}

function stateChoices(): StateFilter[] {
  return Object.keys(STATE) as StateFilter[];
}

function compareMaps(a: string | null, b: string | null): number {
  if ((a === null) !== (b === null)) return a === null ? 1 : -1;
  return (a ?? "").localeCompare(b ?? "");
}

function location(map: string | null, concern: string | null): string {
  if (map === null) return "no map";
  return concern === null ? map : `${map} / ${concern}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ");
}

function iconButton(parent: HTMLElement, cls: string, icon: string, label: string, action: () => void): HTMLElement {
  const el = parent.createDiv({ cls: `clickable-icon ${cls}`, attr: { role: "button", tabindex: "0", "aria-label": label } });
  setIcon(el, icon);
  el.onclick = (event) => {
    event.stopPropagation();
    action();
  };
  el.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    action();
  };
  return el;
}

function menuTitle(name: string, count?: number): DocumentFragment {
  return createFragment((fragment) => {
    fragment.createSpan({ cls: "agents-inbox-menu-label", text: name });
    if (count !== undefined) fragment.createSpan({ cls: "agents-inbox-menu-count", text: String(count) });
  });
}

function addChoice(menu: Menu, name: string, count: number, checked: boolean, action: () => void): void {
  menu.addItem((item) => item.setTitle(menuTitle(name, count)).setChecked(checked).onClick(action));
}

function showBelow(menu: Menu, button: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom }, button.doc);
}

function newSection(g: Shown["groups"][number], groupBy: GroupBy): Section {
  const el = createDiv({ cls: "agents-inbox-group" });
  const { map, concern } = g.entries[0].entry.item;
  if (groupBy === "concern" || groupBy === "map") el.dataset.map = map ?? "";
  if (groupBy === "concern") el.dataset.concern = concern ?? "";
  const title = g.title === null ? null : el.createEl("h4", { cls: "agents-inbox-group-title", text: g.title });
  return { el, title };
}
