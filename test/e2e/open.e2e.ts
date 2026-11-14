import { $, browser, expect } from "@wdio/globals";
import { openInbox, reset, VIEW_TYPE } from "./helpers";

const RIGHT_PANEL = `.mod-right-split .workspace-leaf-content[data-type="${VIEW_TYPE}"]`;

describe("opening the inbox", () => {
  beforeEach(reset);

  it("loads the agents plugin", async () => {
    expect(await browser.executeObsidian(({ plugins }) => plugins.agents !== undefined)).toBe(true);
  });

  it("opens the panel in the right sidebar with the Open inbox command", async () => {
    await browser.executeObsidianCommand("agents:open-inbox");
    await expect($(RIGHT_PANEL)).toBeDisplayed();
  });

  it("opens the panel in the right sidebar from the ribbon icon", async () => {
    await $('.side-dock-ribbon-action[aria-label="Open inbox"]').click();
    await expect($(RIGHT_PANEL)).toBeDisplayed();
  });

  it("keeps one panel when opened twice", async () => {
    await openInbox();
    await openInbox();
    expect(await browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length, VIEW_TYPE)).toBe(1);
  });
});
