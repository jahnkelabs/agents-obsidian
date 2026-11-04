import { describe, expect, it } from "vitest";
import { parse, SchemaError, serialize } from "../src/schema";
import { expectHandStyleKept, frontmatter, HAND } from "./hand";

const VALID = `---
type: inbox
kind: decide
map: 2026-11-03t0530-inbox-plugin
concern: c1-inbox-protocol
from: plan · s1
status: answered
options:
  - yaml
  - gray-matter
recommended: yaml
answer: gray-matter
note: "keep it: simple"
answered_by: inbox
created_at: 2026-11-03T05:30:00.000Z
answered_at: 2026-11-03T05:31:00.000Z
---
**Deciding — Frontmatter library**

\`\`\`
found:  two libraries
\`\`\`
`;

function replaceLine(key: string, line: string): string {
  return VALID.replace(new RegExp(`^${key}:.*$`, "m"), line);
}

describe("schema", () => {
  it("round-trips an item serialize wrote byte for byte", () => {
    expect(serialize(parse(VALID))).toBe(VALID);
  });

  it("keeps a hand-formatted item's values, comments, quotes, flow style, key order, and unknown keys", () => {
    const after = serialize(parse(HAND));

    expect(frontmatter(after)).toEqual(frontmatter(HAND));
    expectHandStyleKept(after);
    expect(parse(after).body).toBe(parse(HAND).body);
  });

  it("keeps the body verbatim", () => {
    expect(parse(VALID).body).toBe(VALID.slice(VALID.indexOf("**Deciding")));
  });

  it.each([
    ["kind", replaceLine("kind", "kind: maybe")],
    ["status", replaceLine("status", "status: done")],
    ["type", replaceLine("type", "type: note")],
    ["map", replaceLine("map", "map: Not A Slug")],
    ["concern", replaceLine("map", "map: null")],
    ["from", replaceLine("from", "from: ''")],
    ["recommended", replaceLine("recommended", "recommended: toml")],
    ["answer", replaceLine("answer", "answer: toml")],
    ["answered_by", replaceLine("answered_by", "answered_by: email")],
    ["created_at", replaceLine("created_at", "created_at: yesterday")],
    ["answered_at", replaceLine("answered_at", "answered_at: null")],
    ["note", VALID.replace(/^note:.*\n/m, "")],
    ["body", VALID.slice(0, VALID.indexOf("**Deciding"))],
    ["frontmatter", VALID.slice(4)],
  ])("rejects a malformed %s with a message naming it", (field, text) => {
    expect(() => parse(text)).toThrow(SchemaError);
    expect(() => parse(text)).toThrow(new RegExp(`^${field}:`));
  });

  it.each(["1", "Nov 3", "2026", "11/03/2026", "2026-11-03", "2026-11-03T05:30:00", "2026-11-03 05:30:00Z"])(
    "rejects the timestamp %s",
    (value) => {
      expect(() => parse(replaceLine("created_at", `created_at: "${value}"`))).toThrow(/^created_at:/);
    },
  );

  it("rejects an answer on an item still awaiting you", () => {
    const text = replaceLine("status", "status: awaiting-you");
    expect(() => parse(text)).toThrow(/^answer:/);
  });
});
