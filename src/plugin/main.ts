import { relative, sep } from "node:path";
import { FileSystemAdapter, Notice, Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { DOC_VIEW_TYPE, type DocState, HOVER_SOURCE, InboxDocView } from "./doc-view";
import { type Entry, isInboxPath, lastAgentAt, unread } from "./inbox";
import { InboxItemView, ITEM_VIEW_TYPE } from "./item-view";
import type { GroupBy, Sort } from "./organize";
import { GROUP_BY, InboxView, SORT, VIEW_TYPE } from "./view";

interface Sidebar {
  groupBy: GroupBy;
  sort: Sort;
}

interface Data {
  seen: Record<string, number>;
  sidebar?: Sidebar;
}

const DEFAULT_SIDEBAR: Sidebar = { groupBy: "concern", sort: "newest" };

export default class AgentsPlugin extends Plugin {
  docs = "";
  sidebar: Sidebar = DEFAULT_SIDEBAR;
  private seen: Record<string, number> = {};
  private readonly docLeaves = new WeakMap<WorkspaceLeaf, WorkspaceLeaf>();

  async onload(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Agents inbox needs a vault on the local file system.");
      return;
    }
    this.docs = adapter.getBasePath();
    const data = (await this.loadData()) as Partial<Data> | null;
    this.seen = data?.seen ?? {};
    this.sidebar = readSidebar(data?.sidebar);

    this.registerView(VIEW_TYPE, (leaf) => new InboxView(leaf, this));
    this.registerView(ITEM_VIEW_TYPE, (leaf) => new InboxItemView(leaf, this));
    this.registerView(DOC_VIEW_TYPE, (leaf) => new InboxDocView(leaf, this));
    this.registerHoverLinkSource(HOVER_SOURCE, { display: "Agents", defaultMod: false });
    this.addRibbonIcon("inbox", "Open inbox", () => void this.open());
    this.addCommand({ id: "open-inbox", name: "Open inbox", callback: () => void this.open() });

    const onChange = (file: TAbstractFile) => this.refresh(file.path);
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.refresh(file.path);
        this.refresh(oldPath);
      }),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refreshContext()));
  }

  vaultPath(path: string): string {
    return relative(this.docs, path).split(sep).join("/");
  }

  seenAt(vaultPath: string): number | undefined {
    return this.seen[vaultPath];
  }

  async markSeen(entry: Entry): Promise<void> {
    const path = this.vaultPath(entry.path);
    if (!unread(entry, this.seen[path])) return;
    this.seen[path] = Math.max(Date.now(), lastAgentAt(entry.item) ?? 0);
    try {
      await this.save();
    } finally {
      this.refreshList();
    }
  }

  async saveSidebar(sidebar: Sidebar): Promise<void> {
    this.sidebar = sidebar;
    try {
      await this.save();
    } catch (error) {
      new Notice(`Inbox: ${(error as Error).message}`);
    }
  }

  async openItem(vaultPath: string): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(ITEM_VIEW_TYPE).find((candidate) => candidate.getViewState().state?.path === vaultPath);
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: ITEM_VIEW_TYPE, state: { path: vaultPath }, active: true });
    }
    await workspace.revealLeaf(leaf);
    workspace.setActiveLeaf(leaf, { focus: true });
  }

  async openContext(itemLeaf: WorkspaceLeaf, target: { path: string; subpath: string | null; row: number | null }): Promise<void> {
    const { workspace } = this.app;
    const itemPath = pathOf(itemLeaf.getViewState().state, "path") ?? "";
    const leaf = this.docLeaf(itemLeaf) ?? workspace.createLeafBySplit(itemLeaf, "vertical");
    this.docLeaves.set(itemLeaf, leaf);
    await this.showDoc(leaf, { ...target, itemPath });
    workspace.setActiveLeaf(itemLeaf, { focus: true });
  }

  async showDoc(leaf: WorkspaceLeaf, state: DocState): Promise<void> {
    await leaf.setViewState({ type: DOC_VIEW_TYPE, state: { ...state }, active: false });
    this.refreshContext();
  }

  contextPath(itemLeaf: WorkspaceLeaf): string | null {
    return pathOf(this.docLeaf(itemLeaf)?.getViewState().state, "path");
  }

  private docLeaf(itemLeaf: WorkspaceLeaf): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(DOC_VIEW_TYPE);
    const known = this.docLeaves.get(itemLeaf);
    if (known !== undefined && leaves.includes(known)) return known;
    const itemPath = pathOf(itemLeaf.getViewState().state, "path");
    return itemPath === null ? null : (leaves.find((leaf) => pathOf(leaf.getViewState().state, "itemPath") === itemPath) ?? null);
  }

  private refreshContext(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ITEM_VIEW_TYPE)) {
      if (leaf.view instanceof InboxItemView) leaf.view.renderContext();
    }
  }

  private async open(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getRightLeaf(true);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private save(): Promise<void> {
    return this.saveData({ seen: this.seen, sidebar: this.sidebar } satisfies Data);
  }

  private refreshList(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof InboxView) leaf.view.refresh();
    }
  }

  private refresh(vaultPath: string): void {
    if (!isInboxPath(vaultPath)) {
      if (vaultPath.startsWith("maps/")) this.refreshContext();
      return;
    }
    this.refreshList();
    for (const leaf of this.app.workspace.getLeavesOfType(ITEM_VIEW_TYPE)) {
      if (leaf.view instanceof InboxItemView) void leaf.view.refresh(vaultPath);
    }
  }
}

function readSidebar(saved: unknown): Sidebar {
  const fields = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  return {
    groupBy: oneOf(GROUP_BY, fields.groupBy) ?? DEFAULT_SIDEBAR.groupBy,
    sort: oneOf(SORT, fields.sort) ?? DEFAULT_SIDEBAR.sort,
  };
}

function pathOf(state: Record<string, unknown> | undefined, key: string): string | null {
  const value = state?.[key];
  return typeof value === "string" ? value : null;
}

function oneOf<T extends string>(choices: Record<T, string>, value: unknown): T | undefined {
  return typeof value === "string" && Object.hasOwn(choices, value) ? (value as T) : undefined;
}
