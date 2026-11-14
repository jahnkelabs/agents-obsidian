import { browser, expect } from "@wdio/globals";
import {
  answerUnderLock,
  ask,
  card,
  chatAnswersThenPanelClicks,
  holdLock,
  itemAt,
  M1_ANSWERED,
  M1_NEWER,
  openInbox,
  readBytes,
  reset,
  rewrittenText,
  waitForObsidianToSee,
} from "./helpers";

const WINNER = "Already answered by chat: beta";

describe("a card that chat already won", () => {
  beforeEach(reset);

  it("shows the winning answer, writes nothing, and leaves at a later change dated after the answer", async () => {
    await openInbox();
    const alpha = card("m1-newer").$('button[data-option="alpha"]');
    const result = card("m1-newer").$(".agents-inbox-result");

    const release = holdLock(M1_NEWER);
    try {
      await browser.waitUntil(
        async () => {
          if (await alpha.isEnabled()) await alpha.click();
          return !(await alpha.isEnabled());
        },
        { timeoutMsg: "the click never reached the panel" },
      );
      answerUnderLock(M1_NEWER, "beta", "chat");
    } finally {
      release();
    }
    const written = readBytes(M1_NEWER);

    await expect(result).toHaveText(WINNER);
    await waitForObsidianToSee(M1_NEWER, "chat");
    await browser.pause(250);
    await expect(result).toHaveText(WINNER);
    await expect(card("m1-newer").$$("button")).toBeElementsArrayOfSize(0);
    expect(readBytes(M1_NEWER).equals(written)).toBe(true);
    expect(itemAt(M1_NEWER).answer).toBe("beta");
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");

    ask([], "**Deciding — Next event**\n\nfound: new\n");
    await card("m1-newer").waitForExist({ reverse: true });
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
  });

  it("keeps the winning answer after Obsidian sees chat's write, with no lock held", async () => {
    await openInbox();
    const result = card("m1-newer").$(".agents-inbox-result");

    const { clicked, text } = await chatAnswersThenPanelClicks(M1_NEWER, "beta", "m1-newer", "alpha");
    expect(clicked).toBe(true);

    await expect(result).toHaveText(WINNER);
    await waitForObsidianToSee(M1_NEWER, "chat");
    await browser.pause(250);
    await expect(result).toHaveText(WINNER);
    expect(readBytes(M1_NEWER).toString("utf8")).toBe(text);
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
  });

  it("keeps the winning answer when another inbox write lands before the click", async () => {
    await openInbox();
    const result = card("m1-newer").$(".agents-inbox-result");
    const elsewhere = rewrittenText(M1_ANSWERED, { answered_by: "inbox" });

    const { clicked } = await chatAnswersThenPanelClicks(M1_NEWER, "beta", "m1-newer", "alpha", {
      [M1_ANSWERED]: elsewhere,
    });
    expect(clicked).toBe(true);

    await expect(result).toHaveText(WINNER);
    await waitForObsidianToSee(M1_ANSWERED, "inbox");
    await waitForObsidianToSee(M1_NEWER, "chat");
    await browser.pause(250);
    await expect(result).toHaveText(WINNER);
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
  });
});
