import { expect } from "@wdio/globals";
import { choicesOf, closeInbox, FIXTURES, openInbox, openItem, readBytes, reset, rowIds, tab } from "./helpers";

describe("an item tab", () => {
  beforeEach(reset);

  it("renders the body as markdown", async () => {
    await openItem("m1-newer");
    const body = tab("m1-newer").$(".agents-inbox-body");
    await expect(body.$("strong")).toHaveText("Deciding — m1 newer");
    await expect(body.$("table")).toExist();
    expect(await body.$$("table td").map((cell) => cell.getText())).toEqual(["1", "2"]);
  });

  it("shows one radio button per option on a pick-one item and marks the recommended one", async () => {
    await openItem("m1-newer");
    expect(await choicesOf("m1-newer")).toEqual([
      { option: "alpha", type: "radio", recommended: false },
      { option: "beta", type: "radio", recommended: true },
    ]);
    await openItem("root-question");
    expect(await choicesOf("root-question")).toEqual([
      { option: "yes", type: "radio", recommended: true },
      { option: "no", type: "radio", recommended: false },
    ]);
    await openItem("m1-earlier");
    expect(await choicesOf("m1-earlier")).toEqual([{ option: "approve", type: "radio", recommended: false }]);
  });

  it("gives every waiting item a note field", async () => {
    await openInbox();
    const ids = await rowIds();
    expect(ids).toHaveLength(7);
    for (const id of ids) {
      await openItem(id);
      await expect(tab(id).$("textarea.agents-inbox-note")).toExist();
    }
  });

  it("leaves every file on disk byte-identical after rendering", async () => {
    const before = FIXTURES.map(readBytes);
    await openInbox();
    const ids = await rowIds();
    for (const id of ids) await openItem(id);
    await closeInbox();
    for (const id of ids) await openItem(id);
    FIXTURES.forEach((rel, n) => expect(readBytes(rel).equals(before[n])).toBe(true));
  });
});
