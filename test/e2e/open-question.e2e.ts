import { browser, expect } from "@wdio/globals";
import { card, itemAt, M2_OPEN_QUESTION, openInbox, readBytes, reset } from "./helpers";

const ID = "m2-open-question";

describe("an item with no options", () => {
  beforeEach(reset);

  it("refuses an empty note and leaves the file unchanged", async () => {
    const before = readBytes(M2_OPEN_QUESTION);
    await openInbox();
    const submit = card(ID).$("button.agents-inbox-submit");
    await expect(card(ID).$$("button.agents-inbox-option")).toBeElementsArrayOfSize(0);
    await expect(submit).toBeDisabled();

    await card(ID).$("textarea.agents-inbox-note").setValue("   ");
    await expect(submit).toBeDisabled();
    await browser.execute((button: HTMLElement) => button.click(), await submit.getElement());
    await browser.pause(500);

    expect(readBytes(M2_OPEN_QUESTION).equals(before)).toBe(true);
    await expect(card(ID)).toExist();
  });

  it("takes the note as its answer", async () => {
    await openInbox();
    const submit = card(ID).$("button.agents-inbox-submit");
    await card(ID).$("textarea.agents-inbox-note").setValue("Inbox panel");
    await expect(submit).toBeEnabled();
    await submit.click();
    await card(ID).waitForExist({ reverse: true });

    const item = itemAt(M2_OPEN_QUESTION);
    expect(item.status).toBe("answered");
    expect(item.answer).toBe("Inbox panel");
    expect(item.note).toBeNull();
    expect(item.answered_by).toBe("inbox");
  });
});
