import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { ask, inbox, inboxAsync, post, readText, tempDocs } from "./cli";
import { frontmatter } from "./hand";

describe("inbox wait on a thread", () => {
  it("returns on your message, says it was a message, and prints only that message", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    const waiting = inboxAsync(docs, ["wait", id]);

    await sleep(1500);
    expect(waiting.exited()).toBe(false);
    await post(docs, id, "Does **yes** cost more?\n");
    const result = await waiting;

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      event: "message",
      messages: [{ author: "you", at: expect.any(String), text: "Does **yes** cost more?\n" }],
    });
    expect(result.stdout).not.toContain("Pick a library");
  });

  it("never returns early on the agent's own reply", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    await post(docs, id, "First question?\n");
    expect(inbox(docs, ["wait", id, "--timeout", "0"]).status).toBe(0);
    expect(inbox(docs, ["reply", id], "First answer.\n").status).toBe(0);

    const waiting = inboxAsync(docs, ["wait", id]);
    await sleep(1500);
    expect(inbox(docs, ["reply", id], "A follow-up thought.\n").status).toBe(0);
    await sleep(2500);
    expect(waiting.exited()).toBe(false);

    await post(docs, id, "Second question?\n");
    const result = await waiting;

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).messages.map((m: { text: string }) => m.text)).toEqual(["Second question?\n"]);
  });

  it("returns at once with every message of yours that no wait delivered, and marks them delivered", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    await post(docs, id, "Old question?\n");
    inbox(docs, ["wait", id, "--timeout", "0"]);
    inbox(docs, ["reply", id], "Old answer.\n");
    await post(docs, id, "One.\n");
    await post(docs, id, "Two.\n");

    const result = inbox(docs, ["wait", id, "--timeout", "0"]);

    expect(result.status).toBe(0);
    const { event, messages } = JSON.parse(result.stdout);
    expect(event).toBe("message");
    expect(messages.map((m: { author: string; text: string }) => [m.author, m.text])).toEqual([
      ["you", "One.\n"],
      ["you", "Two.\n"],
    ]);
    const thread = parse(readText(docs, id)).thread;
    expect(thread.filter((m) => m.author === "you").every((m) => typeof m.delivered_at === "string")).toBe(true);
    expect(inbox(docs, ["wait", id, "--timeout", "0"]).status).toBe(4);
  });

  it("delivers a message you post while the agent writes its reply", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    await post(docs, id, "M1?\n");
    expect(JSON.parse(inbox(docs, ["wait", id, "--timeout", "0"]).stdout).messages.map((m: { text: string }) => m.text)).toEqual(["M1?\n"]);
    await post(docs, id, "M2?\n");
    expect(inbox(docs, ["reply", id], "Answer to M1.\n").status).toBe(0);

    const result = inbox(docs, ["wait", id, "--timeout", "0"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).messages.map((m: { text: string }) => m.text)).toEqual(["M2?\n"]);
  });

  it("times out once every message of yours was delivered", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    await post(docs, id, "Question?\n");
    inbox(docs, ["wait", id, "--timeout", "0"]);
    inbox(docs, ["reply", id], "Answer.\n");

    const result = inbox(docs, ["wait", id, "--timeout", "1"]);

    expect(result.status).toBe(4);
    expect(result.stdout).toBe("");
  });

  it("returns the answer event, with answer, note, and answered_by, over unread messages", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    await post(docs, id, "Never mind.\n");
    inbox(docs, ["answer", id, "--option", "no", "--note", "later", "--by", "inbox"]);

    const result = inbox(docs, ["wait", id, "--timeout", "0"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ event: "answer", answer: "no", note: "later", answered_by: "inbox" });
  });

  it("returns a pick-many answer as a list", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--select", "many", "--option", "lint", "--option", "e2e"]);
    const waiting = inboxAsync(docs, ["wait", id]);

    await sleep(500);
    inbox(docs, ["answer", id, "--option", "lint", "--option", "e2e"]);

    expect(JSON.parse((await waiting).stdout)).toEqual({ event: "answer", answer: ["lint", "e2e"], note: null, answered_by: "chat" });
  });
});

describe("a final answer on a thread", () => {
  it.each([0, 1, 4])("closes the item after %i exchanges and keeps the thread verbatim", async (exchanges) => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    for (let n = 0; n < exchanges; n++) {
      await post(docs, id, `Question ${n}?\n\n- a\n- b\n`);
      expect(inbox(docs, ["reply", id], `Answer ${n}.\n\n\`\`\`mermaid\ngraph LR; a --> b\n\`\`\`\n`).status).toBe(0);
    }
    const before = readText(docs, id);
    const threadText = before.slice(before.indexOf("thread:"), before.indexOf("\nanswer:"));

    const result = inbox(docs, ["answer", id, "--option", "yes"]);

    expect(result.status).toBe(0);
    const after = readText(docs, id);
    expect(parse(after)).toMatchObject({ status: "answered", answer: "yes" });
    expect(frontmatter(after).thread).toEqual(frontmatter(before).thread);
    expect(after).toContain(threadText);
    expect(parse(after).thread).toHaveLength(2 * exchanges);
  });

  it("allows the answer before the agent replies to your last message", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    await post(docs, id, "Unanswered question?\n");

    expect(inbox(docs, ["answer", id, "--option", "no"]).status).toBe(0);
    expect(parse(readText(docs, id)).thread.map((m) => m.text)).toEqual(["Unanswered question?\n"]);
  });

  it("refuses every message after the answer and writes nothing", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    await post(docs, id, "Question?\n");
    inbox(docs, ["answer", id, "--option", "yes"]);
    const before = readText(docs, id);

    const reply = inbox(docs, ["reply", id], "Too late.\n");
    const yours = await post(docs, id, "Also too late.\n");

    expect(reply.status).toBe(3);
    expect(JSON.parse(reply.stdout)).toEqual({ answer: "yes", note: null, answered_by: "chat" });
    expect(yours.appended).toBe(false);
    expect(readText(docs, id)).toBe(before);
  });
});
