import { relative, sep } from "node:path";
import { FileSystemAdapter, Notice, Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { type Entry, isInboxPath, lastAgentAt, unread } from "./inbox";
import { InboxItemView, ITEM_VIEW_TYPE } from "./item-view";
import { InboxView, VIEW_TYPE } from "./view";

interface Data {
  seen: Record<string, number>;
}

export default class AgentsPlugin extends Plugin {
  docs = "";
  private seen: Record<string, number> = {};

  async onload(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Agents inbox needs a vault on the local file system.");
      return;
    }
    this.docs = adapter.getBasePath();
    const data = (await this.loadData()) as Partial<Data> | null;
    this.seen = data?.seen ?? {};

    this.registerView(VIEW_TYPE, (leaf) => new InboxView(leaf, this));
    this.registerView(ITEM_VIEW_TYPE, (leaf) => new InboxItemView(leaf, this));
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
      await this.saveData({ seen: this.seen } satisfies Data);
    } finally {
      this.refreshList();
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

  private refreshList(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof InboxView) leaf.view.refresh();
    }
  }

  private refresh(vaultPath: string): void {
    if (!isInboxPath(vaultPath)) return;
    this.refreshList();
    for (const leaf of this.app.workspace.getLeavesOfType(ITEM_VIEW_TYPE)) {
      if (leaf.view instanceof InboxItemView) void leaf.view.refresh(vaultPath);
    }
  }
}
