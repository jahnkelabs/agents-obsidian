import { browser, expect } from "@wdio/globals";
import {
  answerButton,
  checkedOf,
  choicesOf,
  choose,
  holdLock,
  inbox,
  inboxAsync,
  itemAt,
  M1_NEWER,
  M2_PICK_MANY,
  markTab,
  openItem,
  readBytes,
  reset,
  revise,
  revisedText,
  row,
  tab,
  tabKept,
  waitForNotice,
  writeUnderLock,
} from "./helpers";

describe("an agent revises the choices", () => {
  beforeEach(reset);

  it("updates an open tab in place, unticks a removed choice, says so, and records the revision in the thread", async () => {
    await openItem("m2-pick-many");
    await choose("m2-pick-many", "lint");
    await choose("m2-pick-many", "e2e");
    await markTab("m2-pick-many");
    const waiting = inboxAsync(["wait", "m2-pick-many", "--timeout", "4"]);

    revise("m2-pick-many", ["--option", "lint", "--option", "typecheck", "--option", "smoke", "--recommended", "smoke", "--note", "e2e is **too slow**."]);

    await browser.waitUntil(async () => (await choicesOf("m2-pick-many")).some((choice) => choice.option === "smoke"), {
      timeoutMsg: "the tab never showed the revised choices",
    });
    expect(await choicesOf("m2-pick-many")).toEqual([
      { option: "lint", type: "checkbox", recommended: false },
      { option: "typecheck", type: "checkbox", recommended: false },
      { option: "smoke", type: "checkbox", recommended: true },
    ]);
    expect(await checkedOf("m2-pick-many")).toEqual(["lint"]);
    await waitForNotice(/revised the choices, so e2e is no longer ticked/);
    expect(await tabKept("m2-pick-many")).toBe(true);

    const entry = tab("m2-pick-many").$('.agents-inbox-message.is-revision[data-author="agent"]');
    await expect(entry.$(".agents-inbox-message-text strong")).toHaveText("too slow");
    await expect(entry.$(".agents-inbox-revision-text")).toHaveText(
      "revised the choices · added smoke · removed unit tests, e2e · recommended smoke",
    );
    await expect(tab("m2-pick-many").$(".agents-inbox-waiting")).not.toBeDisplayed();

    expect((await waiting).status).toBe(4);

    await answerButton("m2-pick-many").click();
    await expect(tab("m2-pick-many").$(".agents-inbox-result")).toHaveText("Answered by inbox: lint");
    expect(itemAt(M2_PICK_MANY).answer).toEqual(["lint"]);
  });

  it("removes the choices with --open, and the tab then takes a text answer", async () => {
    await openItem("m1-newer");
    await choose("m1-newer", "alpha");

    revise("m1-newer", ["--open", "--note", "Tell me in your own words."]);

    await browser.waitUntil(async () => (await tab("m1-newer").$$(".agents-inbox-choice").length) === 0, {
      timeoutMsg: "the choices never left the tab",
    });
    await waitForNotice(/revised the choices, so alpha is no longer ticked/);
    await expect(tab("m1-newer").$(".agents-inbox-answer-label")).toHaveText("Your answer · open question");
    await expect(tab("m1-newer").$(".agents-inbox-revision-text")).toHaveText("revised the choices · removed alpha, beta");

    await tab("m1-newer").$("textarea.agents-inbox-note").setValue("gamma, please");
    await answerButton("m1-newer").click();
    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by inbox: gamma, please");
    expect(itemAt(M1_NEWER)).toMatchObject({ status: "answered", options: [], answer: "gamma, please" });
  });

  it("refuses an answer sent against choices that changed under it, writes nothing, and shows the current choices", async () => {
    await openItem("m1-newer");
    await choose("m1-newer", "alpha");
    const submit = answerButton("m1-newer");
    const text = revisedText(M1_NEWER, ["--option", "beta", "--option", "gamma"]);

    const release = holdLock(M1_NEWER);
    try {
      await browser.waitUntil(
        async () => {
          if (await submit.isEnabled()) await submit.click();
          return !(await submit.isEnabled());
        },
        { timeoutMsg: "the click never reached the tab" },
      );
      writeUnderLock(M1_NEWER, text);
    } finally {
      release();
    }

    await waitForNotice(/choices changed before your answer arrived, so nothing was sent/);
    expect(readBytes(M1_NEWER).toString("utf8")).toBe(text);
    expect(itemAt(M1_NEWER)).toMatchObject({ status: "awaiting-you", answer: null, options: ["beta", "gamma"] });
    await browser.waitUntil(async () => (await choicesOf("m1-newer")).map((choice) => choice.option).join() === "beta,gamma", {
      timeoutMsg: "the tab never showed the current choices",
    });
    expect(await checkedOf("m1-newer")).toEqual([]);
    await expect(row("m1-newer")).toExist();

    await choose("m1-newer", "gamma");
    await submit.click();
    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by inbox: gamma");
  });

  it("lets a revise on an answered item exit 3 and leaves the tab answered", async () => {
    await openItem("m1-newer");
    await choose("m1-newer", "beta");
    await answerButton("m1-newer").click();
    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by inbox: beta");
    const before = readBytes(M1_NEWER);

    const result = inbox(["revise", "m1-newer", "--option", "alpha", "--option", "gamma"]);

    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "beta", note: null, answered_by: "inbox" });
    expect(readBytes(M1_NEWER).equals(before)).toBe(true);
    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by inbox: beta");
  });
});
