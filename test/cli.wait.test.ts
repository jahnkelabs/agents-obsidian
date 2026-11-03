import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { ask, inbox, inboxAsync, tempDocs } from "./cli";

describe("inbox wait", () => {
  it("blocks until the item is answered, then prints the answer", async () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    const waiting = inboxAsync(docs, ["wait", id]);

    await sleep(2500);
    expect(waiting.exited()).toBe(false);

    expect(inbox(docs, ["answer", id, "--option", "no", "--note", "later"]).status).toBe(0);
    const result = await waiting;

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "no", note: "later", answered_by: "chat" });
  });

  it("exits 4 when the timeout expires on an unanswered item", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    const started = Date.now();
    const result = await inboxAsync(docs, ["wait", id, "--timeout", "2"]);

    expect(result.status).toBe(4);
    expect(result.stdout).toBe("");
    expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
  });

  it("returns at once for an item already answered", () => {
    const docs = tempDocs();
    const id = ask(docs);
    inbox(docs, ["answer", id, "--text", "go"]);

    const result = inbox(docs, ["wait", id, "--timeout", "0"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).answer).toBe("go");
  });

  it("exits 2 for a missing item", () => {
    const result = inbox(tempDocs(), ["wait", "2026-11-03t0530-s1-nothing"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no inbox item 2026-11-03t0530-s1-nothing");
  });

  it("exits 2 for a malformed item rather than waiting on it", () => {
    const docs = tempDocs();
    const id = ask(docs);
    writeFileSync(join(docs, "inbox", `${id}.md`), "not an item\n");

    const result = inbox(docs, ["wait", id]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("frontmatter:");
  });
});
