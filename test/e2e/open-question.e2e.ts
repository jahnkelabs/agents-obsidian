import { expect } from "@wdio/globals";
import { answerButton, itemAt, M2_OPEN_QUESTION, openItem, readBytes, reset, row, tab } from "./helpers";

const ID = "m2-open-question";

describe("an item with no options", () => {
  beforeEach(reset);

  it("refuses an empty note and leaves the file unchanged", async () => {
    const before = readBytes(M2_OPEN_QUESTION);
    await openItem(ID);
    await expect(tab(ID).$$(".agents-inbox-choice")).toBeElementsArrayOfSize(0);
    await expect(answerButton(ID)).toBeDisabled();

    await tab(ID).$("textarea.agents-inbox-note").setValue("   ");
    await expect(answerButton(ID)).toBeDisabled();

    expect(readBytes(M2_OPEN_QUESTION).equals(before)).toBe(true);
    await expect(row(ID)).toExist();
  });

  it("takes the note as its answer", async () => {
    await openItem(ID);
    await tab(ID).$("textarea.agents-inbox-note").setValue("Inbox panel");
    await expect(answerButton(ID)).toBeEnabled();
    await answerButton(ID).click();
    await expect(tab(ID).$(".agents-inbox-result")).toHaveText("Answered by inbox: Inbox panel");
    await row(ID).waitForExist({ reverse: true });

    const item = itemAt(M2_OPEN_QUESTION);
    expect(item.status).toBe("answered");
    expect(item.answer).toBe("Inbox panel");
    expect(item.note).toBeNull();
    expect(item.answered_by).toBe("inbox");
  });
});
