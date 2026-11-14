import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { ask, inboxAsync, post, readText, tempDocs } from "./cli";

const REPLIERS = 12;
const POSTERS = 6;
const ANSWERERS = 4;

describe("concurrent thread writes", () => {
  it("loses no write, accepts no message after the answer, and lets exactly one answer win", async () => {
    const docs = tempDocs();
    const labels = Array.from({ length: ANSWERERS }, (_, n) => `option-${n}`);
    const id = ask(docs, labels.flatMap((label) => ["--option", label]));

    const replies = Array.from({ length: REPLIERS }, (_, n) => inboxAsync(docs, ["reply", id], `reply ${n}\n`));
    const answers = labels.map((label) => inboxAsync(docs, ["answer", id, "--option", label]));
    const posts = Array.from({ length: POSTERS }, (_, n) => post(docs, id, `post ${n}\n`));
    const [replyResults, answerResults, postResults] = await Promise.all([
      Promise.all(replies),
      Promise.all(answers),
      Promise.all(posts),
    ]);

    const winners = answerResults.filter((r) => r.status === 0);
    expect(winners).toHaveLength(1);
    expect(answerResults.filter((r) => r.status === 3)).toHaveLength(ANSWERERS - 1);
    expect(replyResults.every((r) => r.status === 0 || r.status === 3)).toBe(true);

    const item = parse(readText(docs, id));
    const winning = JSON.parse(winners[0].stdout);
    expect(item).toMatchObject({ status: "answered", answer: winning.answer });

    const appendedReplies = replyResults.flatMap((r, n) => (r.status === 0 ? [`reply ${n}\n`] : []));
    const appendedPosts = postResults.flatMap((r, n) => (r.appended ? [`post ${n}\n`] : []));
    expect(item.thread.map((m) => m.text).sort()).toEqual([...appendedReplies, ...appendedPosts].sort());

    for (const message of item.thread) expect(Date.parse(message.at)).toBeLessThanOrEqual(Date.parse(item.answered_at!));
    for (const r of replyResults.filter((r) => r.status === 3)) expect(JSON.parse(r.stdout)).toEqual(winning);
    for (const r of postResults.filter((r) => !r.appended)) expect(r.item.answer).toEqual(winning.answer);
  });

  it("keeps every message of parallel replies and posts on an open item, in order", async () => {
    const docs = tempDocs();
    const id = ask(docs);

    const [replyResults] = await Promise.all([
      Promise.all(Array.from({ length: REPLIERS }, (_, n) => inboxAsync(docs, ["reply", id], `reply ${n}\n`))),
      Promise.all(Array.from({ length: POSTERS }, (_, n) => post(docs, id, `post ${n}\n`))),
    ]);

    expect(replyResults.map((r) => r.status)).toEqual(Array(REPLIERS).fill(0));
    const thread = parse(readText(docs, id)).thread;
    expect(thread).toHaveLength(REPLIERS + POSTERS);
    const times = thread.map((m) => Date.parse(m.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(replyResults.map((r) => JSON.parse(r.stdout).messages)).size).toBe(REPLIERS);
  });
});
