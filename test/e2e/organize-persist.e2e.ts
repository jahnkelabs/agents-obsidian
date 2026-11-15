import { writeFileSync } from "node:fs";
import { browser, expect } from "@wdio/globals";
import {
  arrange,
  chips,
  closeInbox,
  groupTitles,
  header,
  itemTabs,
  openInbox,
  openItem,
  pick,
  pluginDataFile,
  reset,
  ROOT_THREAD,
  row,
  rowIds,
  savedSidebar,
  search,
  searchBox,
  seenPaths,
  unreadMark,
} from "./helpers";

describe("organizing across a restart", () => {
  beforeEach(reset);

  it("restores the group-by and sort, empties the search and filters, and keeps the unread state", async () => {
    await openItem("root-thread");
    await unreadMark("root-thread").waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await seenPaths()).includes(ROOT_THREAD), {
      timeoutMsg: `the plugin's saved data never recorded ${ROOT_THREAD} as seen`,
    });

    await arrange("Kind", "Oldest first");
    await search("root");
    await pick("filter", "decide");
    expect(await rowIds()).toEqual(["root-question", "root-thread"]);
    await browser.waitUntil(async () => JSON.stringify(await savedSidebar()) === JSON.stringify({ groupBy: "kind", sort: "oldest" }), {
      timeoutMsg: "the plugin's saved data never recorded the group-by and sort",
    });

    await closeInbox();
    await browser.reloadObsidian();
    await openInbox();

    expect((await itemTabs()).paths).toEqual([]);
    expect(await groupTitles()).toEqual(["decide", "approve"]);
    expect(await rowIds()).toEqual(["m1-c2", "m1-newer", "root-question", "m2-open-question", "root-thread", "m2-pick-many", "m1-earlier"]);
    expect(await searchBox().getValue()).toBe("");
    expect(await chips()).toEqual([]);
    expect(await header()).toBe("Inbox 7");
    await expect(row("root-thread")).toExist();
    await expect(unreadMark("root-thread")).not.toExist();
  });

  it("reads a saved group-by or sort it does not know as the default", async () => {
    await closeInbox();
    writeFileSync(await pluginDataFile(), JSON.stringify({ seen: {}, sidebar: { groupBy: "colour", sort: 7 } }));
    await browser.reloadObsidian();
    await openInbox();

    expect(await groupTitles()).toEqual(["m1 / c1", "m1 / c2", "m2", "No map"]);
    expect(await rowIds()).toEqual(["m1-newer", "m1-earlier", "m1-c2", "m2-pick-many", "m2-open-question", "root-thread", "root-question"]);
  });
});
