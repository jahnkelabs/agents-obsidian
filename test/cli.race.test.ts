import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "../src/schema";
import { ask, inboxAsync, tempDocs } from "./cli";

const ANSWERERS = 20;

describe("concurrent answers", () => {
  it("lets exactly one of twenty parallel answers win", async () => {
    const docs = tempDocs();
    const labels = Array.from({ length: ANSWERERS }, (_, n) => `option-${n}`);
    const id = ask(docs, labels.flatMap((label) => ["--option", label]));

    const results = await Promise.all(labels.map((label) => inboxAsync(docs, ["answer", id, "--option", label])));

    const winners = results.filter((r) => r.status === 0);
    const losers = results.filter((r) => r.status === 3);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(ANSWERERS - 1);

    const stored = parse(readFileSync(join(docs, "inbox", `${id}.md`), "utf8"));
    const winning = JSON.parse(winners[0].stdout);
    expect(stored.answer).toBe(winning.answer);
    for (const loser of losers) expect(JSON.parse(loser.stdout)).toEqual(winning);
  });
});
