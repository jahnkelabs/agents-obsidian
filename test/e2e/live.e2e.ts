import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@wdio/globals";
import {
  ask,
  composer,
  composerState,
  inbox,
  itemAt,
  M1_EARLIER,
  M2_OPEN_QUESTION,
  markComposer,
  markWindow,
  openInbox,
  openItem,
  panel,
  reply,
  reset,
  row,
  rowIds,
  tab,
  vault,
  windowKept,
} from "./helpers";

describe("live updates", () => {
  beforeEach(reset);

  it("drops an item answered in the terminal without a reload", async () => {
    await openInbox();
    await markWindow();

    const result = inbox(["answer", "m1-earlier", "--option", "approve", "--by", "chat"]);
    expect(result.status).toBe(0);

    await row("m1-earlier").waitForExist({ reverse: true });
    expect(await windowKept()).toBe(true);
    expect(itemAt(M1_EARLIER).answered_by).toBe("chat");
  });

  it("drops a deleted item without a reload", async () => {
    await openInbox();
    await markWindow();

    rmSync(join(vault(), M1_EARLIER));

    await row("m1-earlier").waitForExist({ reverse: true });
    expect(await windowKept()).toBe(true);
  });

  it("drops an item moved out of its inbox without a reload", async () => {
    await openInbox();
    await markWindow();

    renameSync(join(vault(), M2_OPEN_QUESTION), join(vault(), "maps/m2/m2-open-question.md"));

    await row("m2-open-question").waitForExist({ reverse: true });
    expect(await windowKept()).toBe(true);
  });

  it("shows a new map item under its map and concern without a reload", async () => {
    await openInbox();
    await markWindow();

    const id = ask(["--map", "m1", "--concern", "c2", "--option", "one", "--option", "two"], "**Deciding — Live map item**\n\nfound: new\n");

    await row(id).waitForExist();
    await expect(panel().$('.agents-inbox-group[data-map="m1"][data-concern="c2"]').$(`[data-id="${id}"]`)).toExist();
    expect(await windowKept()).toBe(true);
  });

  it("shows a new root item under No map without a reload", async () => {
    await openInbox();
    await markWindow();

    const id = ask([], "**Deciding — Live root item**\n\nfound: new\n");

    await row(id).waitForExist();
    await expect(panel().$('.agents-inbox-group[data-map=""]').$(`[data-id="${id}"]`)).toExist();
    expect(await windowKept()).toBe(true);
  });

  it("keeps the composer's focus and text while a reply and another item arrive", async () => {
    await openItem("m1-newer");
    await composer("m1-newer").setValue("half a thought");
    await markComposer("m1-newer");
    expect(await composerState("m1-newer")).toEqual({ kept: true, focused: true, value: "half a thought" });

    reply("m1-newer", "An agent reply\n");
    await tab("m1-newer").$('.agents-inbox-message[data-author="agent"]').waitForExist();
    const id = ask(["--map", "m1", "--concern", "c1", "--option", "one"], "**Deciding — Arrives meanwhile**\n\nfound: new\n");
    await row(id).waitForExist();

    expect((await rowIds()).slice(0, 2)).toEqual([id, "m1-newer"]);
    expect(await composerState("m1-newer")).toEqual({ kept: true, focused: true, value: "half a thought" });
  });
});
