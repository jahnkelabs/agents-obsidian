import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { answerItem } from "../src/store";
import { ask, inbox, inboxAsync, itemPath, post, readText, tempDocs } from "./cli";

const ROUNDS = 12;

describe("inbox revise", () => {
  it("replaces select, options, and recommended, and appends one agent entry with the revision and the note", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yaml", "--option", "gray-matter", "--recommended", "yaml"]);
    await post(docs, id, "Is there a TOML option?\n");
    const before = parse(readText(docs, id));

    const result = inbox(docs, [
      "revise", id,
      "--select", "many",
      "--option", "yaml", "--option", "toml", "--option", "json",
      "--recommended", "toml", "--recommended", "yaml",
      "--note", "TOML **reads better**.",
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ revised: true });
    const item = parse(readText(docs, id));
    expect(item).toMatchObject({ status: "awaiting-you", select: "many", options: ["yaml", "toml", "json"], recommended: ["toml", "yaml"] });
    expect(item.thread).toHaveLength(2);
    expect(item.thread[0]).toEqual(before.thread[0]);
    expect(item.thread[1]).toEqual({
      author: "agent",
      at: expect.any(String),
      text: "TOML **reads better**.",
      revision: { select: "many", added: ["toml", "json"], removed: ["gray-matter"], recommended: ["toml", "yaml"] },
    });
    expect(Date.parse(item.thread[1].at)).toBeGreaterThanOrEqual(Date.parse(item.thread[0].at));
    expect(item.body).toBe(before.body);
  });

  it("keeps an omitted flag's value, and drops a kept recommendation that is no longer offered", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--select", "many", "--option", "lint", "--option", "e2e", "--recommended", "lint", "--recommended", "e2e"]);

    expect(inbox(docs, ["revise", id, "--option", "lint", "--option", "unit tests"]).status).toBe(0);

    const item = parse(readText(docs, id));
    expect(item).toMatchObject({ select: "many", options: ["lint", "unit tests"], recommended: ["lint"] });
    expect(item.thread.at(-1)).toEqual({
      author: "agent",
      at: expect.any(String),
      text: "",
      revision: { select: "many", added: ["unit tests"], removed: ["e2e"], recommended: ["lint"] },
    });
  });

  it("changes only the recommendation", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no", "--recommended", "yes"]);

    expect(inbox(docs, ["revise", id, "--recommended", "no"]).status).toBe(0);

    const item = parse(readText(docs, id));
    expect(item).toMatchObject({ select: "one", options: ["yes", "no"], recommended: "no" });
    expect(item.thread.at(-1)?.revision).toEqual({ select: "one", added: [], removed: [], recommended: ["no"] });
  });

  it("removes the choices with --open, and the item then takes a text answer", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--select", "many", "--option", "a", "--option", "b", "--recommended", "a"]);

    const result = inbox(docs, ["revise", id, "--open", "--note", "Tell me in your own words."]);

    expect(result.status).toBe(0);
    const item = parse(readText(docs, id));
    expect(item).toMatchObject({ select: "one", options: [], recommended: null });
    expect(item.thread.at(-1)).toMatchObject({
      text: "Tell me in your own words.",
      revision: { select: "one", added: [], removed: ["a", "b"], recommended: [] },
    });

    expect(inbox(docs, ["answer", id, "--text", "neither"]).status).toBe(0);
    expect(parse(readText(docs, id)).answer).toBe("neither");
  });

  it("exits 3 on an answered item, prints the winner, and writes nothing", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    inbox(docs, ["answer", id, "--option", "no", "--note", "later", "--by", "inbox"]);
    const before = readText(docs, id);

    const result = inbox(docs, ["revise", id, "--option", "yes", "--option", "maybe"]);

    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "no", note: "later", answered_by: "inbox" });
    expect(readText(docs, id)).toBe(before);
  });

  it.each([
    ["nothing to revise", [], /give --open/],
    ["--open with --option", ["--open", "--option", "a"], /--open takes no/],
    ["a recommendation outside the options", ["--option", "a", "--recommended", "z"], /^inbox: recommended:/m],
    ["two recommendations on a pick-one item", ["--select", "one", "--recommended", "a", "--recommended", "b"], /^inbox: recommended:/m],
    ["an unknown select", ["--select", "some"], /^inbox: select:/m],
  ])("refuses %s and writes nothing", (_, args, error) => {
    const docs = tempDocs();
    const id = ask(docs, ["--select", "many", "--option", "a", "--option", "b"]);
    const before = readText(docs, id);

    const result = inbox(docs, ["revise", id, ...args]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(error);
    expect(readText(docs, id)).toBe(before);
  });

  it("does not wake inbox wait", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    const waiting = inboxAsync(docs, ["wait", id]);

    await sleep(1500);
    expect(inbox(docs, ["revise", id, "--option", "yes", "--option", "maybe", "--note", "Added maybe."]).status).toBe(0);
    await sleep(2500);
    expect(waiting.exited()).toBe(false);

    await post(docs, id, "What does maybe mean?\n");
    const result = await waiting;

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      event: "message",
      messages: [{ author: "you", at: expect.any(String), text: "What does maybe mean?\n" }],
    });
  });

  it("leaves your message for inbox wait when a revision follows it", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "a", "--option", "b"]);
    await post(docs, id, "What about c?\n");
    expect(inbox(docs, ["revise", id, "--option", "a", "--option", "b", "--option", "c", "--note", "Added c."]).status).toBe(0);

    const result = inbox(docs, ["wait", id, "--timeout", "0"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      event: "message",
      messages: [{ author: "you", at: expect.any(String), text: "What about c?\n" }],
    });
  });

  it("refuses an option label given twice", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "a", "--option", "b"]);
    const before = readText(docs, id);

    const result = inbox(docs, ["revise", id, "--option", "a", "--option", "a", "--option", "c"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^inbox: options: must not repeat a label/m);
    expect(readText(docs, id)).toBe(before);
  });
});

describe("an answer against revised choices", () => {
  it.each([
    ["a removed label", [], ["--option", "yes", "--option", "maybe"], ["no"]],
    ["a label after --open", ["--select", "many"], ["--open"], ["yes"]],
    ["text after an open question gains options", null, ["--option", "a", "--option", "b"], "free words"],
    ["two labels after pick-many becomes pick-one", ["--select", "many"], ["--select", "one"], ["yes", "no"]],
  ] as const)("refuses %s sent against the earlier choices, and writes nothing", async (_, askArgs, reviseArgs, answer) => {
    const docs = tempDocs();
    const id = ask(docs, askArgs === null ? [] : [...askArgs, "--option", "yes", "--option", "no"]);
    const { select, options } = parse(readText(docs, id));
    expect(inbox(docs, ["revise", id, ...reviseArgs]).status).toBe(0);
    const before = readText(docs, id);

    const result = await answerItem(itemPath(docs, id), {
      answer: typeof answer === "string" ? answer : [...answer],
      note: null,
      answered_by: "inbox",
      basis: { select, options },
    });

    expect(result).toMatchObject({ won: false, stale: true });
    expect(readText(docs, id)).toBe(before);
  });

  it("exits 2 and names the field for a label the revised choices no longer offer", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    inbox(docs, ["revise", id, "--option", "yes", "--option", "maybe", "--recommended", "maybe"]);
    const before = readText(docs, id);

    const result = inbox(docs, ["answer", id, "--option", "no"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/^inbox: answer: must be one of the options/m);
    expect(readText(docs, id)).toBe(before);
  });

  it("accepts a label that is still offered", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    inbox(docs, ["revise", id, "--option", "yes", "--option", "maybe"]);

    const result = inbox(docs, ["answer", id, "--option", "yes"]);

    expect(result.status).toBe(0);
    expect(parse(readText(docs, id))).toMatchObject({ status: "answered", answer: "yes" });
  });

  it("lets exactly one of a racing revise and answer take effect", async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const docs = tempDocs();
      const id = ask(docs, ["--option", "keep", "--option", "drop"]);

      const [revised, answered] = await Promise.all([
        inboxAsync(docs, ["revise", id, "--option", "keep", "--option", "new"]),
        inboxAsync(docs, ["answer", id, "--option", "drop"]),
      ]);

      const item = parse(readText(docs, id));
      const revisions = item.thread.filter((message) => message.revision !== undefined);
      if (answered.status === 0) {
        expect(revised.status).toBe(3);
        expect(item).toMatchObject({ status: "answered", answer: "drop", options: ["keep", "drop"] });
        expect(revisions).toEqual([]);
      } else {
        expect(revised.status).toBe(0);
        expect([2, 5]).toContain(answered.status);
        expect(item).toMatchObject({ status: "awaiting-you", answer: null, options: ["keep", "new"] });
        expect(revisions).toHaveLength(1);
      }
    }
  });
});

describe("a revision entry in the schema", () => {
  const ITEM = (thread: string) => `---
type: inbox
kind: decide
map: null
concern: null
from: plan · s1
status: awaiting-you
select: one
options: [a, b]
recommended: null
thread:
${thread}
answer: null
note: null
answered_by: null
created_at: 2026-11-14T21:00:00.000Z
answered_at: null
---
**Deciding — Pick**
`;
  const REVISION = "    revision: { select: one, added: [b], removed: [c], recommended: [] }";

  it("parses an agent entry with a revision and empty text", () => {
    const item = parse(ITEM(`  - author: agent\n    at: 2026-11-14T21:01:00.000Z\n    text: ""\n${REVISION}`));
    expect(item.thread[0]).toEqual({
      author: "agent",
      at: "2026-11-14T21:01:00.000Z",
      text: "",
      revision: { select: "one", added: ["b"], removed: ["c"], recommended: [] },
    });
  });

  it.each([
    ["a revision from you", `  - author: you\n    at: 2026-11-14T21:01:00.000Z\n    text: hi\n${REVISION}`],
    ["empty text without a revision", `  - author: agent\n    at: 2026-11-14T21:01:00.000Z\n    text: ""`],
    ["a revision with an unknown select", `  - author: agent\n    at: 2026-11-14T21:01:00.000Z\n    text: ""\n    revision: { select: some, added: [], removed: [], recommended: [] }`],
    ["a revision missing removed", `  - author: agent\n    at: 2026-11-14T21:01:00.000Z\n    text: ""\n    revision: { select: one, added: [], recommended: [] }`],
  ])("rejects %s, naming the thread", (_, thread) => {
    expect(() => parse(ITEM(thread))).toThrow(/^thread:/);
  });
});
