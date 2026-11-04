import { expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { ask, card, cardIds, closeInbox, groupTitles, openInbox, panel, reset, snapshot } from "./helpers";

const BROKEN = `---
type: inbox
kind: wonder
map: null
concern: null
from: fixture · s9
status: awaiting-you
options: []
recommended: null
answer: null
note: null
answered_by: null
created_at: 2026-11-01T09:00:00.000Z
answered_at: null
---
**Deciding — Broken**
`;

describe("listing awaiting items", () => {
  beforeEach(reset);

  it("groups items by map then concern, root last, newest first, without answered items", async () => {
    await openInbox();
    expect(await groupTitles()).toEqual(["m1 / c1", "m2", "No map"]);
    expect(await cardIds()).toEqual(["m1-newer", "m1-older", "m2-open-question", "root-question"]);
  });

  it("writes no file while listing", async () => {
    const before = snapshot();
    await openInbox();
    await closeInbox();
    await openInbox();
    expect(snapshot()).toEqual(before);

    const id = ask([], "**Deciding — Relist**\n\nfound: new\n");
    await card(id).waitForExist();
    const after = snapshot();
    expect(Object.keys(after).filter((rel) => !(rel in before))).toEqual([`inbox/${id}.md`]);
    for (const rel of Object.keys(before)) expect(after[rel]).toBe(before[rel]);
  });

  it("shows a malformed item as an error card that names the file and the field", async () => {
    await obsidianPage.write("inbox/broken.md", BROKEN);
    await openInbox();
    const broken = panel().$('.agents-inbox-broken[data-path="inbox/broken.md"]');
    await broken.waitForExist();
    const text = await broken.getText();
    expect(text).toContain("inbox/broken.md");
    expect(text).toContain("kind:");
    await expect(broken.$$("button")).toBeElementsArrayOfSize(0);
  });
});
