import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { inbox, tempDocs } from "./cli";

const BODY = "**Deciding — Pick a library**\n\n```\nfound:  two\n```\n";

describe("inbox ask", () => {
  it("writes a valid awaiting item and prints its id", () => {
    const docs = tempDocs();
    const result = inbox(
      docs,
      ["ask", "--kind", "decide", "--from", "plan · s1", "--option", "yaml", "--option", "gray-matter", "--recommended", "yaml"],
      BODY,
    );

    expect(result.status).toBe(0);
    const id = result.stdout.trim();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}t\d{4}-s1-deciding-pick-a-library$/);

    const item = parse(readFileSync(join(docs, "inbox", `${id}.md`), "utf8"));
    expect(item).toMatchObject({
      kind: "decide",
      from: "plan · s1",
      status: "awaiting-you",
      options: ["yaml", "gray-matter"],
      recommended: "yaml",
      answer: null,
      body: BODY,
    });
  });

  it("adds a suffix when the id is already taken", () => {
    const docs = tempDocs();
    const args = ["ask", "--kind", "decide", "--from", "plan · s1"];
    const first = inbox(docs, args, BODY).stdout.trim();
    const second = inbox(docs, args, BODY).stdout.trim();

    expect(second).not.toBe(first);
    expect(second).toMatch(/-2$/);
  });

  it("rejects an item the schema rejects, naming the field", () => {
    const docs = tempDocs();
    const result = inbox(docs, ["ask", "--kind", "maybe", "--from", "plan · s1"], BODY);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/kind:/);
  });
});
