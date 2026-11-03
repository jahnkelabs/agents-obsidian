import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { ask, inbox, tempDocs } from "./cli";

function read(docs: string, id: string): string {
  return readFileSync(join(docs, "inbox", `${id}.md`), "utf8");
}

function body(text: string): string {
  return text.slice(text.indexOf("\n---\n") + 5);
}

describe("inbox answer", () => {
  it("records a chat answer and leaves the body untouched", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    const before = read(docs, id);

    const result = inbox(docs, ["answer", id, "--option", "yes", "--note", "ship it", "--by", "chat"]);

    expect(result.status).toBe(0);
    const after = read(docs, id);
    expect(parse(after)).toMatchObject({ status: "answered", answer: "yes", note: "ship it", answered_by: "chat" });
    expect(parse(after).answered_at).not.toBeNull();
    expect(body(after)).toBe(body(before));
  });

  it("records chat when --by is omitted, and inbox when given", () => {
    const docs = tempDocs();
    const chat = ask(docs);
    const fromInbox = ask(docs, [], "**Approve — Roster**\n");

    inbox(docs, ["answer", chat, "--text", "go"]);
    inbox(docs, ["answer", fromInbox, "--text", "go", "--by", "inbox"]);

    expect(parse(read(docs, chat)).answered_by).toBe("chat");
    expect(parse(read(docs, fromInbox)).answered_by).toBe("inbox");
  });

  it("rejects an option the item does not offer and leaves the item unchanged", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes"]);
    const before = read(docs, id);

    const result = inbox(docs, ["answer", id, "--option", "maybe"]);

    expect(result.status).toBe(2);
    expect(read(docs, id)).toBe(before);
  });

  it("exits 3 and prints the winning answer when the item is already answered", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    inbox(docs, ["answer", id, "--option", "yes"]);

    const result = inbox(docs, ["answer", id, "--option", "no", "--by", "inbox"]);

    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "yes", note: null, answered_by: "chat" });
  });

  it("exits 2 for a missing item", () => {
    const result = inbox(tempDocs(), ["answer", "2026-11-03t0530-s1-nothing", "--text", "go"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no inbox item 2026-11-03t0530-s1-nothing");
  });

  it.each([
    ["a dead process", () => `${spawnSync("node", ["-e", ""]).pid} ${Date.now()}\n`],
    ["over 30 seconds ago", () => `${process.pid} ${Date.now() - 31_000}\n`],
  ])("recovers a stale lock left by %s", (_, lock) => {
    const docs = tempDocs();
    const id = ask(docs);
    const lockPath = join(docs, "inbox", `${id}.md.lock`);
    writeFileSync(lockPath, lock());

    const result = inbox(docs, ["answer", id, "--text", "go"]);

    expect(result.status).toBe(0);
    expect(parse(read(docs, id)).answer).toBe("go");
  });
});
