import { FileSystemAdapter, Notice, Plugin, type TAbstractFile } from "obsidian";
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

    const onChange = (file: TAbstractFile) => isInboxPath(file.path) && this.refresh();
    this.registerEvent(this.app.vault.on("create", onChange));
    this.registerEvent(this.app.vault.on("modify", onChange));
    this.registerEvent(this.app.vault.on("delete", onChange));
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => (isInboxPath(file.path) || isInboxPath(oldPath)) && this.refresh()),
    );
  }

  private async open(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("split");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private refresh(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof InboxView) void leaf.view.refresh();
    }
  }
}
