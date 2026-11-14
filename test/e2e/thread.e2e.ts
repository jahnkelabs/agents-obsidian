import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import {
  authorsOf,
  bodyBytes,
  chatAnswersThenTabClicks,
  composer,
  expectNoAnsweringControls,
  inbox,
  itemAt,
  M1_EARLIER,
  M1_NEWER,
  markWindow,
  openItem,
  readBytes,
  reset,
  tab,
  windowKept,
} from "./helpers";

const MESSAGE = "Here is the flow:\n\n```mermaid\ngraph LR\n  ask --> reply\n```\n\nIs **this** right?";

describe("an item's thread", () => {
  beforeEach(reset);

  it("adds your message to the thread, rendered as markdown with its mermaid diagram drawn, and leaves the body bytes unchanged", async () => {
    const body = bodyBytes(M1_NEWER);
    await openItem("m1-newer");
    await composer("m1-newer").setValue(MESSAGE);
    await tab("m1-newer").$("button.agents-inbox-send").click();

    const message = tab("m1-newer").$('.agents-inbox-message[data-author="you"]');
    await expect(message.$("strong")).toHaveText("this");
    await message.$(".mermaid svg").waitForExist();
    await expect(composer("m1-newer")).toHaveValue("");

    const item = itemAt(M1_NEWER);
    expect(item.thread).toEqual([{ author: "you", at: expect.any(String), text: MESSAGE }]);
    expect(item.status).toBe("awaiting-you");
    expect(bodyBytes(M1_NEWER).equals(body)).toBe(true);
  });

  it("sends with Cmd/Ctrl+Enter, while Enter adds a line", async () => {
    await openItem("m1-earlier");
    await composer("m1-earlier").click();
    await browser.keys("line one");
    await browser.keys(Key.Enter);
    await browser.keys("line two");
    await browser.keys([Key.Ctrl, Key.Enter]);

    await expect(tab("m1-earlier").$$(".agents-inbox-message")).toBeElementsArrayOfSize(1);
    expect(itemAt(M1_EARLIER).thread.map((m) => m.text)).toEqual(["line one\nline two"]);
    await expect(composer("m1-earlier")).toHaveValue("");
  });

  it("renders an existing thread in order, with authors, markdown, and mermaid", async () => {
    await openItem("root-thread");
    expect(await authorsOf("root-thread")).toEqual(["you", "agent"]);
    await expect(tab("root-thread").$('.agents-inbox-message[data-author="you"] strong')).toHaveText("e2e");
    await expect(tab("root-thread").$('.agents-inbox-message[data-author="agent"] em')).toHaveText("40 s");
    await tab("root-thread").$('.agents-inbox-message[data-author="agent"] .mermaid svg').waitForExist();
  });

  it("shows an inbox reply from the CLI in the open tab without a reload", async () => {
    await openItem("m1-newer");
    await markWindow();

    const result = inbox(["reply", "m1-newer"], "Use **beta**.\n");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ messages: 1 });

    await expect(tab("m1-newer").$('.agents-inbox-message[data-author="agent"] strong')).toHaveText("beta");
    expect(await windowKept()).toBe(true);
  });

  it("keeps Send disabled for an empty message and writes nothing", async () => {
    const before = readBytes(M1_NEWER);
    await openItem("m1-newer");
    const send = tab("m1-newer").$("button.agents-inbox-send");
    await expect(send).toBeDisabled();
    await composer("m1-newer").setValue("  \n  ");
    await expect(send).toBeDisabled();
    expect(readBytes(M1_NEWER).equals(before)).toBe(true);
  });

  it("refuses a message sent after the answer, shows the item answered, and keeps your text", async () => {
    await openItem("m1-newer");
    await composer("m1-newer").setValue("one more question");

    const { clicked, text } = await chatAnswersThenTabClicks(M1_NEWER, "beta", "m1-newer", "button.agents-inbox-send");
    expect(clicked).toBe(true);

    await expect(tab("m1-newer").$(".agents-inbox-result")).toHaveText("Answered by chat: beta");
    await expect(composer("m1-newer")).toHaveValue("one more question");
    expect(await composer("m1-newer").getProperty("readOnly")).toBe(true);
    await expectNoAnsweringControls(tab("m1-newer"));
    await expect(tab("m1-newer").$("button.agents-inbox-copy-draft")).toBeDisplayed();
    expect(readBytes(M1_NEWER).toString("utf8")).toBe(text);
    expect(itemAt(M1_NEWER).thread).toEqual([]);
  });
});
