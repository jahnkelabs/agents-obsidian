import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { appendMessage } from "../../src/store";
import {
  arrange,
  ask,
  chips,
  filterCounts,
  groupTitles,
  header,
  location,
  markWindow,
  noMatch,
  openInbox,
  pick,
  removeChip,
  reply,
  reset,
  row,
  rowGroups,
  rowIds,
  search,
  searchBox,
  seenPaths,
  snapshot,
  snippet,
  M1_C2,
  M2_OPEN_QUESTION,
  M2_PICK_MANY,
  unreadMark,
  vault,
  windowKept,
} from "./helpers";

const WAITING = ["m1-newer", "m1-earlier", "m1-c2", "m2-pick-many", "m2-open-question", "root-thread", "root-question"];

async function expectEachOnce(expected: string[]): Promise<string[]> {
  const ids = await rowIds();
  expect([...ids].sort()).toEqual([...expected].sort());
  return ids;
}

describe("organizing the inbox", () => {
  beforeEach(async () => {
    await reset();
    await openInbox();
    await arrange("Map and concern", "Newest first");
  });

  it("narrows the rows as you type, ignoring case, and highlights a body or thread match", async () => {
    const before = snapshot();
    expect(await header()).toBe("Inbox 7");

    await search("ROOT");
    expect(await rowIds()).toEqual(["root-thread", "root-question"]);
    await expect(snippet("root-thread")).not.toExist();
    expect(await header()).toBe("Inbox 2 of 7");

    await search("ubuntu");
    expect(await rowIds()).toEqual(["root-thread"]);
    await expect(snippet("root-thread").$("mark")).toHaveText("Ubuntu");
    expect(await header()).toBe("Inbox 1 of 7");

    await search("what should the NAME");
    expect(await rowIds()).toEqual(["m2-open-question"]);
    await expect(snippet("m2-open-question").$("mark")).toHaveText("What should the name");

    expect(snapshot()).toEqual(before);
  });

  it("filters to items waiting on the agent once your message is the last entry", async () => {
    await appendMessage(join(vault(), M1_C2), { author: "you", text: "Which one is cheaper?\n" });
    await browser.waitUntil(async () => (await filterCounts())["Waiting on the agent"] === 1, {
      timeoutMsg: "the Waiting on the agent count never reached 1",
    });

    await pick("filter", "Waiting on the agent");
    expect(await rowIds()).toEqual(["m1-c2"]);
    expect(await chips()).toEqual(["state: waiting on agent"]);
    expect(await header()).toBe("Inbox 1 of 7");
  });

  it("keeps a broken item visible under a search that matches nothing", async () => {
    writeFileSync(join(vault(), "inbox/broken.md"), "---\ntype: nope\n---\nNot an item.\n");
    await $(`.agents-inbox-broken[data-path="inbox/broken.md"]`).waitForExist();

    await search("zzzz-matches-nothing");
    await expect(noMatch()).toBeDisplayed();
    await expect($(`.agents-inbox-broken[data-path="inbox/broken.md"]`)).toBeDisplayed();
  });

  it("adds an item that changes into a match while a filter is active", async () => {
    await pick("filter", "New reply from the agent");
    expect(await rowIds()).toEqual(["root-thread"]);

    reply("m1-c2", "A reply that makes this item match.\n");
    await browser.waitUntil(async () => (await rowIds()).includes("m1-c2"), { timeoutMsg: "m1-c2 never joined the filtered list" });
    expect(await header()).toBe("Inbox 2 of 7");
  });

  it("drops a chosen map from the menu once it holds no waiting item, and keeps its chip", async () => {
    await pick("filter", "m2");
    expect(await rowIds()).toEqual(["m2-pick-many", "m2-open-question"]);

    rmSync(join(vault(), M2_PICK_MANY));
    rmSync(join(vault(), M2_OPEN_QUESTION));
    await browser.waitUntil(async () => !("m2" in (await filterCounts())), {
      timeoutMsg: "the menu still offered m2 after its last item left",
    });
    expect(await chips()).toEqual(["map: m2"]);
    expect(await rowIds()).toEqual([]);
  });

  it("filters by state, kind, and map with a count on each choice, and removes a section by its chip", async () => {
    await expect(unreadMark("root-thread")).toExist();
    const seen = await seenPaths();
    expect(await filterCounts()).toEqual({
      "New reply from the agent": 1,
      "Waiting on the agent": 0,
      decide: 6,
      approve: 1,
      blocked: 0,
      review: 0,
      m1: 3,
      m2: 2,
      "No map": 2,
    });

    await pick("filter", "approve");
    expect(await rowIds()).toEqual(["m1-earlier"]);
    expect(await chips()).toEqual(["kind: approve"]);
    expect(await header()).toBe("Inbox 1 of 7");

    await pick("filter", "decide");
    expect(await rowIds()).toEqual(WAITING);
    expect(await chips()).toEqual(["kind: decide, approve"]);
    expect(await header()).toBe("Inbox 7 of 7");

    await pick("filter", "m2");
    expect(await rowIds()).toEqual(["m2-pick-many", "m2-open-question"]);
    expect(await chips()).toEqual(["kind: decide, approve", "map: m2"]);

    await pick("filter", "New reply from the agent");
    await pick("filter", "No map");
    expect(await rowIds()).toEqual(["root-thread"]);
    expect(await chips()).toEqual(["state: new reply", "kind: decide, approve", "map: m2, No map"]);
    expect(await header()).toBe("Inbox 1 of 7");

    await removeChip("state");
    expect(await rowIds()).toEqual(["m2-pick-many", "m2-open-question", "root-thread", "root-question"]);
    expect(await chips()).toEqual(["kind: decide, approve", "map: m2, No map"]);

    await pick("filter", "Clear all");
    expect(await chips()).toEqual([]);
    expect(await rowIds()).toEqual(WAITING);
    expect(await header()).toBe("Inbox 7");

    await expect(unreadMark("root-thread")).toExist();
    expect(await seenPaths()).toEqual(seen);
  });

  it("groups and sorts as named, shows the map and concern in rows not grouped by map, and lists every item once", async () => {
    await pick("group", "Map");
    expect(await groupTitles()).toEqual(["m1", "m2", "No map"]);
    expect(await expectEachOnce(WAITING)).toEqual(WAITING);
    await expect(location("m1-newer")).not.toExist();

    await pick("group", "Kind");
    expect(await groupTitles()).toEqual(["decide", "approve"]);
    expect(await rowGroups()).toEqual([
      { id: "root-thread", group: "decide" },
      { id: "m2-pick-many", group: "decide" },
      { id: "root-question", group: "decide" },
      { id: "m2-open-question", group: "decide" },
      { id: "m1-newer", group: "decide" },
      { id: "m1-c2", group: "decide" },
      { id: "m1-earlier", group: "approve" },
    ]);
    await expect(location("m1-newer")).toHaveText("m1 / c1");
    await expect(location("m2-pick-many")).toHaveText("m2");
    await expect(location("root-question")).toHaveText("No map");

    const today = ask([], "**Deciding — Asked today**\n\nfound: new\n");
    await row(today).waitForExist();
    const all = [today, ...WAITING];

    await pick("group", "Age");
    expect(await groupTitles()).toEqual(["Today", "Older"]);
    expect((await rowGroups()).map(({ id, group }) => `${group}: ${id}`)).toEqual([
      `Today: ${today}`,
      "Older: root-thread",
      "Older: m2-pick-many",
      "Older: root-question",
      "Older: m2-open-question",
      "Older: m1-newer",
      "Older: m1-earlier",
      "Older: m1-c2",
    ]);
    await expectEachOnce(all);

    await pick("group", "None");
    expect(await groupTitles()).toEqual([]);
    expect(await expectEachOnce(all)).toEqual([
      today,
      "root-thread",
      "m2-pick-many",
      "root-question",
      "m2-open-question",
      "m1-newer",
      "m1-earlier",
      "m1-c2",
    ]);

    await pick("group", "Oldest first");
    expect(await rowIds()).toEqual([
      "m1-c2",
      "m1-earlier",
      "m1-newer",
      "root-question",
      "m2-open-question",
      "root-thread",
      "m2-pick-many",
      today,
    ]);

    reply("m1-c2", "Later activity\n");
    await unreadMark("m1-c2").waitForExist();
    await pick("group", "Latest activity");
    expect(await expectEachOnce(all)).toEqual([
      "m1-c2",
      today,
      "root-thread",
      "m2-pick-many",
      "root-question",
      "m2-open-question",
      "m1-newer",
      "m1-earlier",
    ]);
  });

  it("says how many items the search and filters hide, and one action clears them all", async () => {
    await pick("filter", "m1");
    await search("no such text anywhere");
    await expect(noMatch()).toBeDisplayed();
    await expect(noMatch().$(".agents-inbox-no-match-title")).toHaveText("No items match");
    await expect(noMatch().$(".agents-inbox-no-match-hint")).toHaveText("7 items are hidden by your search and filters.");
    expect(await rowIds()).toEqual([]);
    expect(await header()).toBe("Inbox 0 of 7");

    await noMatch().$("button").click();
    expect(await rowIds()).toEqual(WAITING);
    expect(await searchBox().getValue()).toBe("");
    expect(await chips()).toEqual([]);
    expect(await header()).toBe("Inbox 7");
    await expect(noMatch()).not.toExist();
  });

  it("shows an item that arrives under a filter only if it matches, and counts it either way, without a reload", async () => {
    await markWindow();
    await pick("filter", "No map");
    expect(await rowIds()).toEqual(["root-thread", "root-question"]);

    const hidden = ask(["--map", "m1", "--concern", "c1", "--option", "one"], "**Deciding — Hidden arrival**\n\nfound: new\n");
    await browser.waitUntil(async () => (await header()) === "Inbox 2 of 8", { timeoutMsg: "the header never counted the hidden arrival" });
    await expect(row(hidden)).not.toExist();

    const shown = ask([], "**Deciding — Shown arrival**\n\nfound: new\n");
    await row(shown).waitForExist();
    expect(await header()).toBe("Inbox 3 of 9");
    expect(await rowIds()).toEqual([shown, "root-thread", "root-question"]);
    expect(await windowKept()).toBe(true);
  });
});
