import { FileSystemAdapter, Notice, Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { isInboxPath } from "./inbox";
import { InboxView, VIEW_TYPE } from "./view";

export default class AgentsPlugin extends Plugin {
  async onload(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Agents inbox needs a vault on the local file system.");
      return;
    }
    const docs = adapter.getBasePath();

    this.registerView(VIEW_TYPE, (leaf) => new InboxView(leaf, docs));
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

  private refresh(vaultPath: string): void {
    if (!isInboxPath(vaultPath)) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof InboxView) void leaf.view.refresh(vaultPath);
    }
  }
}
