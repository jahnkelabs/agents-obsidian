import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { inbox, inboxAsync, tempDocs } from "./cli";

const BODY = "**Deciding — Pick a library**\n\n```\nfound:  two\n```\n";
const ASKERS = 20;

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

  it("gives twenty parallel identical asks twenty distinct ids and files", async () => {
    const map = "2026-11-03t0530-inbox-plugin";
    const docs = tempDocs(map);
    const args = ["ask", "--kind", "approve", "--map", map, "--from", "implement · s1"];

    const results = await Promise.all(Array.from({ length: ASKERS }, () => inboxAsync(docs, args, "**Approve — Roster**\n")));

    expect(results.map((r) => r.status)).toEqual(Array(ASKERS).fill(0));
    const ids = results.map((r) => r.stdout.trim());
    expect(new Set(ids).size).toBe(ASKERS);
    expect(readdirSync(join(docs, "maps", map, "inbox")).sort()).toEqual(ids.map((id) => `${id}.md`).sort());
  });

  it("bounds the id of an oversized one-word body", () => {
    const docs = tempDocs();
    const result = inbox(docs, ["ask", "--kind", "decide", "--from", "plan · s1"], `${"a".repeat(300)}\n`);

    expect(result.status).toBe(0);
    const id = result.stdout.trim();
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}t\d{4}-s1-a{60}$/);
    expect(parse(readFileSync(join(docs, "inbox", `${id}.md`), "utf8")).body).toBe(`${"a".repeat(300)}\n`);
  });

  it("rejects an item the schema rejects, naming the field", () => {
    const docs = tempDocs();
    const result = inbox(docs, ["ask", "--kind", "maybe", "--from", "plan · s1"], BODY);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/kind:/);
  });
});
