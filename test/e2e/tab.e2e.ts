import { rmSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import {
  answerButton,
  ask,
  authorsOf,
  expectNoAnsweringControls,
  expectNoControls,
  inbox,
  itemTabs,
  list,
  M1_EARLIER,
  M1_NEWER,
  markTab,
  openInbox,
  openItem,
  readBytes,
  reply,
  reset,
  row,
  rowIds,
  seenPaths,
  tab,
  tabKept,
  unreadMark,
  vault,
} from "./helpers";

const WAITING = ["m1-newer", "m1-earlier", "m1-c2", "m2-pick-many", "m2-open-question", "root-thread", "root-question"];

describe("the sidebar list and the item tab", () => {
  beforeEach(reset);

  it("shows one row per waiting item with its title, kind, and age, and no answering control", async () => {
    await openInbox();
    expect(await rowIds()).toEqual(WAITING);
    await expect(row("m1-newer").$(".agents-inbox-row-title")).toHaveText("Deciding — m1 newer");
    await expect(row("m1-newer").$(".agents-inbox-row-kind")).toHaveText("decide");
    await expect(row("m1-earlier").$(".agents-inbox-row-kind")).toHaveText("approve");
    expect(await row("m1-newer").$(".agents-inbox-row-age").getText()).toMatch(/^(now|\d+[mhd])$/);
    await expectNoControls(list());
  });

  it("marks a row unread after an agent reply, and clears the mark once you view the item, without writing the item", async () => {
    const id = ask(["--option", "a", "--option", "b"], "**Deciding — Unread marker**\n\nfound: new\n");
    const rel = `inbox/${id}.md`;
    await openInbox();
    await row(id).waitForExist();
    await expect(unreadMark(id)).not.toExist();

    reply(id, "A reply\n");
    await unreadMark(id).waitForExist();
    const replied = readBytes(rel);

    await openItem(id);
    await unreadMark(id).waitForExist({ reverse: true });
    expect(readBytes(rel).equals(replied)).toBe(true);
    await browser.waitUntil(async () => (await seenPaths()).includes(rel), {
      timeoutMsg: `the plugin's saved data never recorded ${rel} as seen`,
    });

    reply(id, "Another reply\n");
    await expect(tab(id).$$(".agents-inbox-message")).toBeElementsArrayOfSize(2);
    await expect(unreadMark(id)).not.toExist();
  });

  it("keeps a row unread when the reply reaches an item tab behind another tab, and clears it when you switch to that tab", async () => {
    await openItem("m1-newer");
    await openItem("m1-earlier");

    reply("m1-newer", "A reply you have not seen\n");
    await unreadMark("m1-newer").waitForExist();
    await browser.pause(500);
    await expect(unreadMark("m1-newer")).toExist();

    await openItem("m1-newer");
    await unreadMark("m1-newer").waitForExist({ reverse: true });
  });

  it("opens a row in a main-area tab, and a second click focuses that same tab", async () => {
    await openItem("m1-newer");
    expect(await itemTabs()).toEqual({ paths: [M1_NEWER], active: M1_NEWER, inRoot: true });

    await openItem("m1-earlier");
    expect(await itemTabs()).toEqual({ paths: [M1_EARLIER, M1_NEWER], active: M1_EARLIER, inRoot: true });

    await openItem("m1-newer");
    expect(await itemTabs()).toEqual({ paths: [M1_EARLIER, M1_NEWER], active: M1_NEWER, inRoot: true });
  });

  it("updates an open tab in place on a reply and on an answer from elsewhere, then offers no controls", async () => {
    await openItem("m1-newer");
    await markTab("m1-newer");
    await expect(answerButton("m1-newer")).toExist();

    reply("m1-newer", "Use **beta**.\n");
    await expect(tab("m1-newer").$('.agents-inbox-message[data-author="agent"] strong')).toHaveText("beta");
    expect(await tabKept("m1-newer")).toBe(true);

    const result = inbox(["answer", "m1-newer", "--option", "beta", "--by", "chat"]);
    expect(result.status).toBe(0);
    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by chat: beta");
    await expectNoAnsweringControls(tab("m1-newer"));
    expect(await authorsOf("m1-newer")).toEqual(["agent"]);
    expect(await tabKept("m1-newer")).toBe(true);
  });

  it("shows an item removed while its tab is open as gone, with no controls", async () => {
    await openItem("m1-earlier");
    rmSync(join(vault(), M1_EARLIER));
    await expect(tab("m1-earlier").$(".agents-inbox-missing")).toHaveText("This item no longer exists");
    await expectNoControls(tab("m1-earlier"));
  });
});
