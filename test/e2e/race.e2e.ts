import { browser, expect } from "@wdio/globals";
import { answerUnderLock, ask, card, holdLock, itemAt, M1_NEWER, openInbox, readBytes, reset, waitForObsidianToSee } from "./helpers";

describe("a card that chat already won", () => {
  beforeEach(reset);

  it("shows the winning answer, writes nothing, and leaves at the next vault event", async () => {
    await openInbox();
    const alpha = card("m1-newer").$('button[data-option="alpha"]');

    const release = holdLock(M1_NEWER);
    let written: Buffer | null = null;
    try {
      await alpha.click();
      await expect(alpha).toBeDisabled();
      answerUnderLock(M1_NEWER, "beta", "chat");
      written = readBytes(M1_NEWER);
      await waitForObsidianToSee(M1_NEWER, "chat");
      await browser.pause(250);
    } finally {
      release();
    }

    await expect(card("m1-newer").$(".agents-inbox-result")).toHaveText("Already answered by chat: beta");
    await expect(card("m1-newer").$$("button")).toBeElementsArrayOfSize(0);
    expect(written && readBytes(M1_NEWER).equals(written)).toBe(true);
    expect(itemAt(M1_NEWER).answer).toBe("beta");
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");

    ask([], "**Deciding — Next event**\n\nfound: new\n");
    await card("m1-newer").waitForExist({ reverse: true });
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
  });
});
