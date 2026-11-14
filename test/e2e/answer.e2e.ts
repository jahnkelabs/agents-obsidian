import { chmodSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { $$, browser, expect } from "@wdio/globals";
import { card, inboxAsync, itemAt, M1_NEWER, openInbox, readBytes, reset, ROOT_QUESTION, vault } from "./helpers";

describe("answering with an option", () => {
  beforeEach(reset);

  it("records the option with answered_by inbox, the card leaves, and a waiting inbox wait returns it", async () => {
    const waiting = inboxAsync(["wait", "m1-newer", "--timeout", "45"]);
    await openInbox();
    await card("m1-newer").$("textarea.agents-inbox-note").setValue("looks right");
    expect(waiting.exited()).toBe(false);

    await card("m1-newer").$('button[data-option="alpha"]').click();
    await card("m1-newer").waitForExist({ reverse: true });

    const item = itemAt(M1_NEWER);
    expect(item.status).toBe("answered");
    expect(item.answer).toBe("alpha");
    expect(item.note).toBe("looks right");
    expect(item.answered_by).toBe("inbox");
    expect(item.answered_at).not.toBeNull();

    const result = await waiting;
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "alpha", note: "looks right", answered_by: "inbox" });
  });

  it("records a null note when the note field is empty", async () => {
    await openInbox();
    await card("root-question").$('button[data-option="no"]').click();
    await card("root-question").waitForExist({ reverse: true });

    const item = itemAt(ROOT_QUESTION);
    expect(item.answer).toBe("no");
    expect(item.note).toBeNull();
    expect(item.answered_by).toBe("inbox");
  });

  it("reports a failed write, keeps the card, and re-enables its buttons", async function () {
    if (process.getuid?.() === 0) this.skip();
    const before = readBytes(ROOT_QUESTION);
    await openInbox();
    const dir = dirname(join(vault(), ROOT_QUESTION));
    const mode = statSync(dir).mode;
    chmodSync(dir, 0o555);
    try {
      await card("root-question").$('button[data-option="no"]').click();
      await browser.waitUntil(
        async () => (await $$(".notice").map((notice) => notice.getText())).some((text) => text.startsWith("Inbox:")),
        { timeoutMsg: "no Inbox: notice appeared" },
      );
      await expect(card("root-question").$('button[data-option="yes"]')).toBeEnabled();
      await expect(card("root-question").$('button[data-option="no"]')).toBeEnabled();
    } finally {
      chmodSync(dir, mode);
    }
    expect(readBytes(ROOT_QUESTION).equals(before)).toBe(true);
  });
});
