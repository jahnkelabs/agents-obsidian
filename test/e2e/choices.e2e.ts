import { expect } from "@wdio/globals";
import {
  answerButton,
  checkedOf,
  choicesOf,
  choose,
  inboxAsync,
  itemAt,
  M1_NEWER,
  M2_PICK_MANY,
  openItem,
  readBytes,
  reset,
  row,
  tab,
} from "./helpers";

describe("choosing an answer", () => {
  beforeEach(reset);

  it("shows radio buttons on a pick-one item and answers with one label", async () => {
    await openItem("m1-newer");
    expect(await choicesOf("m1-newer")).toEqual([
      { option: "alpha", type: "radio", recommended: false },
      { option: "beta", type: "radio", recommended: true },
    ]);
    await expect(answerButton("m1-newer")).toBeDisabled();

    await choose("m1-newer", "alpha");
    await choose("m1-newer", "beta");
    expect(await checkedOf("m1-newer")).toEqual(["beta"]);
    await answerButton("m1-newer").click();

    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by inbox: beta");
    const item = itemAt(M1_NEWER);
    expect(item.select).toBe("one");
    expect(item.answer).toBe("beta");
  });

  it("shows checkboxes on a pick-many item and answers with a list of labels", async () => {
    const waiting = inboxAsync(["wait", "m2-pick-many", "--timeout", "45"]);
    await openItem("m2-pick-many");
    expect(await choicesOf("m2-pick-many")).toEqual([
      { option: "lint", type: "checkbox", recommended: true },
      { option: "typecheck", type: "checkbox", recommended: true },
      { option: "unit tests", type: "checkbox", recommended: false },
      { option: "e2e", type: "checkbox", recommended: false },
    ]);

    await choose("m2-pick-many", "e2e");
    await choose("m2-pick-many", "lint");
    expect(await checkedOf("m2-pick-many")).toEqual(["lint", "e2e"]);
    await answerButton("m2-pick-many").click();

    await expect(tab("m2-pick-many").$(".agents-inbox-result")).toHaveText("Answered by inbox: lint, e2e");
    const item = itemAt(M2_PICK_MANY);
    expect(item.select).toBe("many");
    expect(item.answer).toEqual(["lint", "e2e"]);
    expect(item.answered_by).toBe("inbox");

    const result = await waiting;
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ event: "answer", answer: ["lint", "e2e"], note: null, answered_by: "inbox" });
  });

  it("refuses a pick-many answer with nothing ticked and writes nothing", async () => {
    const before = readBytes(M2_PICK_MANY);
    await openItem("m2-pick-many");
    await expect(answerButton("m2-pick-many")).toBeDisabled();

    await choose("m2-pick-many", "lint");
    await expect(answerButton("m2-pick-many")).toBeEnabled();
    await choose("m2-pick-many", "lint");
    await expect(answerButton("m2-pick-many")).toBeDisabled();

    expect(readBytes(M2_PICK_MANY).equals(before)).toBe(true);
    await expect(row("m2-pick-many")).toExist();
  });
});
