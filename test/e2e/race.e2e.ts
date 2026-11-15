import { browser, expect } from "@wdio/globals";
import {
  answerButton,
  answerUnderLock,
  chatAnswersThenTabClicks,
  choose,
  expectNoAnsweringControls,
  holdLock,
  itemAt,
  M1_ANSWERED,
  M1_NEWER,
  openItem,
  readBytes,
  reset,
  rewrittenText,
  row,
  tab,
  waitForObsidianToSee,
} from "./helpers";

const WINNER = "Answered by chat: beta";

describe("a tab whose answer chat already won", () => {
  beforeEach(reset);

  it("shows the winning answer and writes nothing when chat answers while the tab waits on the lock", async () => {
    await openItem("m1-newer");
    await choose("m1-newer", "alpha");
    const submit = answerButton("m1-newer");
    const result = tab("m1-newer").$(".agents-inbox-result");

    const release = holdLock(M1_NEWER);
    try {
      await browser.waitUntil(
        async () => {
          if (await submit.isEnabled()) await submit.click();
          return !(await submit.isEnabled());
        },
        { timeoutMsg: "the click never reached the tab" },
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
    await expectNoAnsweringControls(tab("m1-newer"));
    expect(readBytes(M1_NEWER).equals(written)).toBe(true);
    expect(itemAt(M1_NEWER).answer).toBe("beta");
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
    await row("m1-newer").waitForExist({ reverse: true });
  });

  it("keeps the winning answer after Obsidian sees chat's write, with no lock held", async () => {
    await openItem("m1-newer");
    await choose("m1-newer", "alpha");
    const result = tab("m1-newer").$(".agents-inbox-result");

    const { clicked, text } = await chatAnswersThenTabClicks(M1_NEWER, "beta", "m1-newer", "button.agents-inbox-answer");
    expect(clicked).toBe(true);

    await expect(result).toHaveText(WINNER);
    await waitForObsidianToSee(M1_NEWER, "chat");
    await browser.pause(250);
    await expect(result).toHaveText(WINNER);
    await expectNoAnsweringControls(tab("m1-newer"));
    expect(readBytes(M1_NEWER).toString("utf8")).toBe(text);
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
  });

  it("keeps the winning answer when another inbox write lands before the click", async () => {
    await openItem("m1-newer");
    await choose("m1-newer", "alpha");
    const result = tab("m1-newer").$(".agents-inbox-result");
    const elsewhere = rewrittenText(M1_ANSWERED, { answered_by: "inbox" });

    const { clicked, text } = await chatAnswersThenTabClicks(M1_NEWER, "beta", "m1-newer", "button.agents-inbox-answer", {
      [M1_ANSWERED]: elsewhere,
    });
    expect(clicked).toBe(true);

    await expect(result).toHaveText(WINNER);
    await waitForObsidianToSee(M1_ANSWERED, "inbox");
    await waitForObsidianToSee(M1_NEWER, "chat");
    await browser.pause(250);
    await expect(result).toHaveText(WINNER);
    expect(readBytes(M1_NEWER).toString("utf8")).toBe(text);
    expect(itemAt(M1_NEWER).answered_by).toBe("chat");
  });
});
