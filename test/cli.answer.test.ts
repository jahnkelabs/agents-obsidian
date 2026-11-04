import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { ask, inbox, inboxAsync, tempDocs } from "./cli";
import { expectHandStyleKept, frontmatter, HAND } from "./hand";

const ANSWERERS = 20;

function read(docs: string, id: string): string {
  return readFileSync(join(docs, "inbox", `${id}.md`), "utf8");
}

function deadPid(): number {
  return spawnSync("node", ["-e", ""]).pid!;
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
    expect(parse(after).body).toBe(parse(before).body);
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
    ["a dead process", () => `${deadPid()} ${Date.now()}\n`],
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

  it("lets exactly one of twenty parallel answers win against one stale lock", async () => {
    const docs = tempDocs();
    const labels = Array.from({ length: ANSWERERS }, (_, n) => `option-${n}`);
    const id = ask(docs, labels.flatMap((label) => ["--option", label]));
    writeFileSync(join(docs, "inbox", `${id}.md.lock`), `${deadPid()} ${Date.now()}\n`);

    const results = await Promise.all(labels.map((label) => inboxAsync(docs, ["answer", id, "--option", label])));

    expect(results.filter((r) => r.status === 0)).toHaveLength(1);
    expect(results.filter((r) => r.status === 3)).toHaveLength(ANSWERERS - 1);
  });

  it("keeps an unknown property through wait and answer", () => {
    const docs = tempDocs();
    const id = ask(docs);
    const path = join(docs, "inbox", `${id}.md`);
    writeFileSync(path, read(docs, id).replace("type: inbox\n", "type: inbox\ntags:\n  - urgent\n"));

    expect(inbox(docs, ["wait", id, "--timeout", "0"]).status).toBe(4);
    expect(inbox(docs, ["answer", id, "--text", "go"]).status).toBe(0);

    expect(read(docs, id)).toContain("type: inbox\ntags:\n  - urgent\n");
    expect(JSON.parse(inbox(docs, ["wait", id, "--timeout", "0"]).stdout).answer).toBe("go");
  });

  it("changes only the answer fields of a hand-formatted item", () => {
    const docs = tempDocs();
    const id = "2026-11-03t0530-s1-ship-or-hold";
    mkdirSync(join(docs, "inbox"));
    writeFileSync(join(docs, "inbox", `${id}.md`), HAND);

    expect(inbox(docs, ["answer", id, "--option", "ship"]).status).toBe(0);

    const after = read(docs, id);
    expect(frontmatter(after)).toEqual({
      ...frontmatter(HAND),
      status: "answered",
      answer: "ship",
      answered_by: "chat",
      answered_at: expect.any(String),
    });
    expectHandStyleKept(after);
    expect(parse(after).body).toBe(parse(HAND).body);
  });
});
