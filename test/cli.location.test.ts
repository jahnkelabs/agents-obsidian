import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ask, inbox, tempDocs } from "./cli";

const MAP = "2026-11-03t0530-inbox-plugin";

describe("item location", () => {
  it("files a map item in that map's inbox", () => {
    const docs = tempDocs(MAP);
    const id = ask(docs, ["--map", MAP, "--concern", "c1-inbox-protocol"]);

    expect(id).toContain(`-${MAP}-`);
    expect(existsSync(join(docs, "maps", MAP, "inbox", `${id}.md`))).toBe(true);
    expect(existsSync(join(docs, "inbox"))).toBe(false);
  });

  it("files a map-less item in the root inbox", () => {
    const docs = tempDocs(MAP);
    const id = ask(docs);

    expect(readdirSync(join(docs, "inbox"))).toEqual([`${id}.md`]);
    expect(existsSync(join(docs, "maps", MAP, "inbox"))).toBe(false);
  });

  it("refuses an unknown map and writes nothing", () => {
    const docs = tempDocs(MAP);
    const result = inbox(docs, ["ask", "--kind", "decide", "--from", "plan · s1", "--map", "no-such-map"], "body\n");

    expect(result.status).not.toBe(0);
    expect(readdirSync(docs)).toEqual(["maps"]);
    expect(readdirSync(join(docs, "maps"))).toEqual([MAP]);
    expect(readdirSync(join(docs, "maps", MAP))).toEqual([]);
  });

  it("refuses a concern without a map", () => {
    const docs = tempDocs();
    const result = inbox(docs, ["ask", "--kind", "decide", "--from", "plan · s1", "--concern", "c1"], "body\n");

    expect(result.status).not.toBe(0);
    expect(readdirSync(docs)).toEqual([]);
  });
});
