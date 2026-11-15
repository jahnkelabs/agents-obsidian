import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { ask, inbox, itemPath, post, readText, tempDocs } from "./cli";

describe("inbox reply", () => {
  it("appends the agent's markdown from stdin and prints the message count", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    await post(docs, id, "Which is smaller?\n");
    const body = parse(readText(docs, id)).body;
    const text = "About **40 s**.\n\n```mermaid\ngraph LR; a --> b\n```\n";

    const result = inbox(docs, ["reply", id], text);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ messages: 2 });
    const item = parse(readText(docs, id));
    expect(item.thread[1]).toEqual({ author: "agent", at: expect.any(String), text });
    expect(Date.parse(item.thread[1].at)).toBeGreaterThanOrEqual(Date.parse(item.thread[0].at));
    expect(item.body).toBe(body);
    expect(item.status).toBe("awaiting-you");
  });

  it("stamps a reply no earlier than a future-dated last message", async () => {
    const docs = tempDocs();
    const id = ask(docs);
    await post(docs, id, "Clock ahead.\n");
    const stamped = parse(readText(docs, id)).thread[0].at;
    writeFileSync(itemPath(docs, id), readText(docs, id).replace(stamped, "2099-01-01T00:00:00.000Z"));

    const result = inbox(docs, ["reply", id], "Noted.\n");

    expect(result.status).toBe(0);
    const { thread } = parse(readText(docs, id));
    expect(thread[1].at).toBe(thread[0].at);
    await post(docs, id, "And again.\n");
    expect(parse(readText(docs, id)).thread[2].at).toBe(thread[0].at);
  });

  it("replies to an item with no messages yet", () => {
    const docs = tempDocs();
    const id = ask(docs);

    const result = inbox(docs, ["reply", id], "A note before you ask.\n");

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ messages: 1 });
  });

  it("exits 3 on an answered item, prints the winner, and writes nothing", () => {
    const docs = tempDocs();
    const id = ask(docs, ["--option", "yes", "--option", "no"]);
    inbox(docs, ["answer", id, "--option", "no", "--note", "later", "--by", "inbox"]);
    const before = readText(docs, id);

    const result = inbox(docs, ["reply", id], "Too late.\n");

    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toEqual({ answer: "no", note: "later", answered_by: "inbox" });
    expect(readText(docs, id)).toBe(before);
  });

  it.each(["", " \n\n"])("refuses an empty reply %j, naming the thread, and writes nothing", (text) => {
    const docs = tempDocs();
    const id = ask(docs);
    const before = readText(docs, id);

    const result = inbox(docs, ["reply", id], text);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/thread:/);
    expect(readText(docs, id)).toBe(before);
  });

  it("exits 2 for a missing item", () => {
    const result = inbox(tempDocs(), ["reply", "2026-11-03t0530-s1-nothing"], "Hello.\n");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no inbox item 2026-11-03t0530-s1-nothing");
  });
});
