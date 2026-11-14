import { describe, expect, it } from "vitest";
import { parse, SchemaError, serialize } from "../src/schema";
import { HAND } from "./hand";

const MANY = `---
type: inbox
kind: decide
map: null
concern: null
from: plan · s1
status: answered
select: many
options: [ lint, typecheck, unit tests, e2e ]
recommended: [ lint, typecheck ]
thread:
  - author: you
    at: 2026-11-14T21:40:00.000Z
    text: |
      Does e2e add much CI time?
  - author: agent
    at: 2026-11-14T21:41:12.000Z
    text: |
      About 40 s on Ubuntu.

      \`\`\`mermaid
      graph LR; lint --> e2e
      \`\`\`
answer: [ lint, typecheck, e2e ]
note: null
answered_by: inbox
created_at: 2026-11-14T21:39:00.000Z
answered_at: 2026-11-14T21:42:00.000Z
---
**Deciding — Which CI checks**
`;

const ONE = MANY.replace("select: many", "select: one")
  .replace("recommended: [ lint, typecheck ]", "recommended: lint")
  .replace("answer: [ lint, typecheck, e2e ]", "answer: e2e");

const OPEN = `---
type: inbox
kind: decide
map: null
concern: null
from: plan · s1
status: answered
options: []
recommended: null
answer: anything you like
note: null
answered_by: chat
created_at: 2026-11-03T05:30:00.000Z
answered_at: 2026-11-03T05:31:00.000Z
---
**Deciding — Name it**
`;

function replaceLine(text: string, key: string, line: string): string {
  return text.replace(new RegExp(`^${key}:.*$`, "m"), line);
}

describe("select and list answers", () => {
  it("accepts a pick-many item with list answers, a list recommendation, and a thread", () => {
    const item = parse(MANY);

    expect(item.select).toBe("many");
    expect(item.recommended).toEqual(["lint", "typecheck"]);
    expect(item.answer).toEqual(["lint", "typecheck", "e2e"]);
    expect(item.thread.map((m) => m.author)).toEqual(["you", "agent"]);
    expect(item.thread[1].text).toContain("```mermaid\ngraph LR; lint --> e2e\n```");
  });

  it("accepts a pick-one item with a thread", () => {
    expect(parse(ONE)).toMatchObject({ select: "one", recommended: "lint", answer: "e2e" });
  });

  it("round-trips a pick-many item with a thread byte for byte", () => {
    expect(serialize(parse(MANY))).toBe(MANY);
  });

  it.each([
    ["select", "an unknown select", replaceLine(MANY, "select", "select: some")],
    ["select", "pick-many on an open question", replaceLine(OPEN, "options", "select: many\noptions: []")],
    ["answer", "a list answer on a pick-one item", replaceLine(ONE, "answer", "answer: [e2e]")],
    ["recommended", "a list recommendation on a pick-one item", replaceLine(ONE, "recommended", "recommended: [lint]")],
    ["answer", "an empty list answer", replaceLine(MANY, "answer", "answer: []")],
    ["answer", "a label outside options", replaceLine(MANY, "answer", "answer: [lint, deploy]")],
    ["answer", "a repeated label", replaceLine(MANY, "answer", "answer: [lint, lint]")],
    ["answer", "a single label on a pick-many item", replaceLine(MANY, "answer", "answer: lint")],
    ["recommended", "a recommendation outside options", replaceLine(MANY, "recommended", "recommended: [deploy]")],
    ["recommended", "a single recommended label on a pick-many item", replaceLine(MANY, "recommended", "recommended: lint")],
  ])("rejects %s: %s", (field, _, text) => {
    expect(() => parse(text)).toThrow(SchemaError);
    expect(() => parse(text)).toThrow(new RegExp(`^${field}:`));
  });
});

describe("thread validation", () => {
  it.each([
    ["an unknown author", MANY.replace("author: agent", "author: robot")],
    ["a missing author", MANY.replace("  - author: agent\n    at:", "  - at:")],
    ["a malformed timestamp", MANY.replace("at: 2026-11-14T21:41:12.000Z", "at: yesterday")],
    ["a missing timestamp", MANY.replace("    at: 2026-11-14T21:41:12.000Z\n", "")],
    ["empty text", MANY.replace("Does e2e add much CI time?", "  ")],
    ["missing text", MANY.replace("    text: |\n      Does e2e add much CI time?\n", "")],
    ["a decreasing timestamp", MANY.replace("at: 2026-11-14T21:41:12.000Z", "at: 2026-11-14T21:39:59.000Z")],
    ["a thread that is not a list", replaceLine(OPEN, "options", "options: []\nthread: hello")],
    ["a message that is not a mapping", replaceLine(OPEN, "options", "options: []\nthread: [hello]")],
  ])("rejects %s, naming the thread", (_, text) => {
    expect(() => parse(text)).toThrow(SchemaError);
    expect(() => parse(text)).toThrow(/^thread:/);
  });

  it("accepts two messages with the same timestamp", () => {
    const text = MANY.replace("at: 2026-11-14T21:41:12.000Z", "at: 2026-11-14T21:40:00.000Z");
    expect(parse(text).thread).toHaveLength(2);
  });
});

describe("c1 items", () => {
  it.each([
    ["a hand-formatted pick-one item", HAND, { options: ["ship", "hold"], recommended: "ship", answer: null }],
    ["an answered open question", OPEN, { options: [], recommended: null, answer: "anything you like" }],
  ])("reads %s as pick-one with an empty thread and its meaning unchanged", (_, text, meaning) => {
    const item = parse(text);

    expect(item).toMatchObject({ ...meaning, select: "one", thread: [] });
    expect(parse(serialize(item))).toMatchObject({ ...meaning, select: "one", thread: [] });
  });

  it("adds select and thread when it writes a c1 item", () => {
    const after = serialize(parse(OPEN));

    expect(after).toContain("\nselect: one\n");
    expect(after).toContain("\nthread: []\n");
  });
});
