import { browser, expect } from "@wdio/globals";
import { ask, card, inbox, itemAt, M1_OLDER, markWindow, openInbox, panel, readBytes, reset, windowKept } from "./helpers";

describe("live updates", () => {
  beforeEach(reset);

  it("drops an item answered in the terminal without a reload, and never re-answers it", async () => {
    await openInbox();
    await markWindow();

    const result = inbox(["answer", "m1-older", "--option", "approve", "--by", "chat"]);
    expect(result.status).toBe(0);
    const written = readBytes(M1_OLDER);

    await card("m1-older").waitForExist({ reverse: true });
    expect(await windowKept()).toBe(true);

    await browser.pause(500);
    expect(readBytes(M1_OLDER).equals(written)).toBe(true);
    expect(itemAt(M1_OLDER).answered_by).toBe("chat");
  });

  it("shows a new map item under its map and concern without a reload", async () => {
    await openInbox();
    await markWindow();

    const id = ask(["--map", "m1", "--concern", "c2", "--option", "one", "--option", "two"], "**Deciding — Live map item**\n\nfound: new\n");

    await card(id).waitForExist();
    await expect(panel().$('.agents-inbox-group[data-map="m1"][data-concern="c2"]').$(`[data-id="${id}"]`)).toExist();
    expect(await windowKept()).toBe(true);
  });

  it("shows a new root item under No map without a reload", async () => {
    await openInbox();
    await markWindow();

    const id = ask([], "**Deciding — Live root item**\n\nfound: new\n");

    await card(id).waitForExist();
    await expect(panel().$('.agents-inbox-group[data-map=""]').$(`[data-id="${id}"]`)).toExist();
    expect(await windowKept()).toBe(true);
  });
});
