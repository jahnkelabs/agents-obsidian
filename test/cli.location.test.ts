import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ask, inbox, tempDir, tempDocs } from "./cli";

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

    expect(result.status).toBe(2);
    expect(readdirSync(docs)).toEqual(["maps"]);
    expect(readdirSync(join(docs, "maps"))).toEqual([MAP]);
    expect(readdirSync(join(docs, "maps", MAP))).toEqual([]);
  });

  it("files and finds an item through a map symlinked inside the docs root", () => {
    const docs = tempDocs();
    mkdirSync(join(docs, "archive", MAP), { recursive: true });
    mkdirSync(join(docs, "maps"));
    symlinkSync(join(docs, "archive", MAP), join(docs, "maps", MAP));

    const id = ask(docs, ["--map", MAP]);

    expect(existsSync(join(docs, "archive", MAP, "inbox", `${id}.md`))).toBe(true);
    expect(inbox(docs, ["answer", id, "--text", "go"]).status).toBe(0);
    expect(JSON.parse(inbox(docs, ["wait", id, "--timeout", "0"]).stdout).answer).toBe("go");
  });

  it("refuses a map symlinked outside the docs root and writes nothing there", () => {
    const docs = tempDocs();
    const outside = tempDir();
    mkdirSync(join(docs, "maps"));
    symlinkSync(outside, join(docs, "maps", "escape"));

    const result = inbox(docs, ["ask", "--kind", "decide", "--from", "plan · s1", "--map", "escape"], "body\n");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("resolves outside");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("refuses to read an item through a map symlinked outside the docs root", () => {
    const docs = tempDocs();
    const outside = tempDir();
    const id = ask(tempDocs(), [], "**Deciding — Escape**\n");
    mkdirSync(join(outside, "inbox"));
    writeFileSync(join(outside, "inbox", `${id}.md`), "---\n");
    mkdirSync(join(docs, "maps"));
    symlinkSync(outside, join(docs, "maps", "escape"));

    const result = inbox(docs, ["wait", id, "--timeout", "0"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("resolves outside");
  });

  it("refuses a concern without a map", () => {
    const docs = tempDocs();
    const result = inbox(docs, ["ask", "--kind", "decide", "--from", "plan · s1", "--concern", "c1"], "body\n");

    expect(result.status).toBe(2);
    expect(readdirSync(docs)).toEqual([]);
  });
});
