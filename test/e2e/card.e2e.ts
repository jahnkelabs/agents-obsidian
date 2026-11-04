import { expect } from "@wdio/globals";
import { card, cardIds, closeInbox, FIXTURES, openInbox, optionsOf, readBytes, reset } from "./helpers";

describe("a card", () => {
  beforeEach(reset);

  it("renders the body as markdown", async () => {
    await openInbox();
    const body = card("m1-newer").$(".agents-inbox-body");
    await expect(body.$("strong")).toHaveText("Deciding — m1 newer");
    await expect(body.$("table")).toExist();
    expect(await body.$$("table td").map((cell) => cell.getText())).toEqual(["1", "2"]);
  });

  it("shows one button per option and marks the recommended one", async () => {
    await openInbox();
    expect(await optionsOf("m1-newer")).toEqual([
      { option: "alpha", recommended: false },
      { option: "beta", recommended: true },
    ]);
    expect(await optionsOf("root-question")).toEqual([
      { option: "yes", recommended: true },
      { option: "no", recommended: false },
    ]);
    expect(await optionsOf("m1-older")).toEqual([{ option: "approve", recommended: false }]);
  });

  it("gives every card a note field", async () => {
    await openInbox();
    for (const id of await cardIds()) await expect(card(id).$("textarea.agents-inbox-note")).toExist();
  });

  it("leaves every body on disk byte-identical after rendering", async () => {
    const before = FIXTURES.map(readBytes);
    await openInbox();
    await closeInbox();
    await openInbox();
    FIXTURES.forEach((rel, n) => expect(readBytes(rel).equals(before[n])).toBe(true));
  });
});
