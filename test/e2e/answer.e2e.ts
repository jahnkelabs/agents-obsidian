import { chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { $$, browser, expect } from "@wdio/globals";
import { answerButton, choose, inboxAsync, itemAt, M1_NEWER, openItem, readBytes, reset, ROOT_QUESTION, row, tab, vault } from "./helpers";

describe("answering with an option", () => {
  beforeEach(reset);

  it("records the option with answered_by inbox, the row leaves, and a waiting inbox wait returns it", async () => {
    const waiting = inboxAsync(["wait", "m1-newer", "--timeout", "45"]);
    await openItem("m1-newer");
    await tab("m1-newer").$("textarea.agents-inbox-note").setValue("looks right");
    expect(waiting.exited()).toBe(false);

    await choose("m1-newer", "alpha");
    await answerButton("m1-newer").click();
    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by inbox: alpha");
    await row("m1-newer").waitForExist({ reverse: true });

    const item = itemAt(M1_NEWER);
    expect(item.status).toBe("answered");
    expect(item.answer).toBe("alpha");
    expect(item.note).toBe("looks right");
    expect(item.answered_by).toBe("inbox");
    expect(item.answered_at).not.toBeNull();

    const result = await waiting;
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ event: "answer", answer: "alpha", note: "looks right", answered_by: "inbox" });
  });

  it("records a null note when the note field is empty", async () => {
    await openItem("root-question");
    await choose("root-question", "no");
    await answerButton("root-question").click();
    await row("root-question").waitForExist({ reverse: true });

    const item = itemAt(ROOT_QUESTION);
    expect(item.answer).toBe("no");
    expect(item.note).toBeNull();
    expect(item.answered_by).toBe("inbox");
  });

  it("reports a failed write, keeps the tab's choice, and re-enables its controls", async function () {
    if (process.getuid?.() === 0) this.skip();
    const before = readBytes(ROOT_QUESTION);
    await openItem("root-question");
    await choose("root-question", "no");
    const dir = dirname(join(vault(), ROOT_QUESTION));
    const mode = statSync(dir).mode;
    chmodSync(dir, 0o555);
    try {
      await answerButton("root-question").click();
      await browser.waitUntil(
        async () => (await $$(".notice").map((notice) => notice.getText())).some((text) => text.startsWith("Inbox:")),
        { timeoutMsg: "no Inbox: notice appeared" },
      );
      await expect(answerButton("root-question")).toBeEnabled();
      await expect(tab("root-question").$('.agents-inbox-choice[data-option="yes"] input')).toBeEnabled();
      await expect(tab("root-question").$('.agents-inbox-choice[data-option="no"] input')).toBeSelected();
    } finally {
      chmodSync(dir, mode);
    }
    expect(readBytes(ROOT_QUESTION).equals(before)).toBe(true);
    await expect(row("root-question")).toExist();
  });
});
