import { describe, expect, it } from "vitest";
import { contextDocs, parseCitation, stepIndex } from "../src/plugin/context";

const PATHS = new Set([
  "maps/m1/map.md",
  "maps/m1/c1/requirements.md",
  "maps/m1/c1/design.md",
  "maps/m1/c1/implementation.md",
]);
const has = (path: string): boolean => PATHS.has(path);

describe("contextDocs", () => {
  it("lists the map, then the concern's three documents, in order", () => {
    expect(contextDocs("m1", "c1", has)).toEqual([
      { kind: "map", label: "Map", vaultPath: "maps/m1/map.md" },
      { kind: "requirements", label: "Requirements", vaultPath: "maps/m1/c1/requirements.md" },
      { kind: "design", label: "Design", vaultPath: "maps/m1/c1/design.md" },
      { kind: "implementation", label: "Implementation", vaultPath: "maps/m1/c1/implementation.md" },
    ]);
  });

  it("lists only the map when the item has no concern", () => {
    expect(contextDocs("m1", null, has).map((doc) => doc.kind)).toEqual(["map"]);
  });

  it("omits a document the vault does not hold", () => {
    const without = (path: string): boolean => has(path) && !path.endsWith("design.md");
    expect(contextDocs("m1", "c1", without).map((doc) => doc.kind)).toEqual(["map", "requirements", "implementation"]);
  });

  it("returns nothing when no document exists", () => {
    expect(contextDocs("m1", "c1", () => false)).toEqual([]);
    expect(contextDocs("m2", "c9", has)).toEqual([]);
  });

  it("asks exists only about the map's own paths", () => {
    const asked: string[] = [];
    contextDocs("m1", "c1", (path) => {
      asked.push(path);
      return true;
    });
    expect(asked.sort()).toEqual([
      "maps/m1/c1/design.md",
      "maps/m1/c1/implementation.md",
      "maps/m1/c1/requirements.md",
      "maps/m1/map.md",
    ]);
  });
});

describe("parseCitation", () => {
  const resolve = (linkpath: string): string | null => (linkpath === "c1/design" ? "maps/m1/c1/design.md" : null);

  it("splits the link text at the first # into a path and a heading", () => {
    expect(parseCitation("c1/design#Interfaces", null, resolve)).toEqual({
      vaultPath: "maps/m1/c1/design.md",
      subpath: "Interfaces",
      row: null,
    });
  });

  it("keeps any later # inside the heading", () => {
    expect(parseCitation("c1/design#C# notes#Deep", null, resolve)?.subpath).toBe("C# notes#Deep");
  });

  it("gives a null heading for a citation with no heading", () => {
    expect(parseCitation("c1/design", null, resolve)).toEqual({ vaultPath: "maps/m1/c1/design.md", subpath: null, row: null });
  });

  it("gives a null heading for a trailing #", () => {
    expect(parseCitation("c1/design#", null, resolve)?.subpath).toBeNull();
  });

  it("passes only the part before # to resolve", () => {
    const seen: string[] = [];
    parseCitation("c1/design#Interfaces", null, (linkpath) => {
      seen.push(linkpath);
      return "x.md";
    });
    expect(seen).toEqual(["c1/design"]);
  });

  it("returns null when the link path resolves to no file", () => {
    expect(parseCitation("c9/design#Interfaces", "criterion 2", resolve)).toBeNull();
  });

  it("reads the row from a display text of criterion <n>", () => {
    expect(parseCitation("c1/design#Acceptance criteria", "criterion 2", resolve)?.row).toBe(2);
  });

  it("reads the row from a display text of Row <n>, ignoring case and outer space", () => {
    expect(parseCitation("c1/design#Acceptance criteria", "Row 3", resolve)?.row).toBe(3);
    expect(parseCitation("c1/design#Acceptance criteria", "  CRITERION 12 ", resolve)?.row).toBe(12);
  });

  it("gives a null row for any other display text", () => {
    for (const display of [null, "", "the design", "criterion", "criterion two", "criterion 2 here", "rows 2", "criterion -1"]) {
      expect(parseCitation("c1/design#Acceptance criteria", display, resolve)?.row).toBeNull();
    }
  });
});

describe("stepIndex", () => {
  it("numbers the steps in order, null first", () => {
    const steps = [null, "sliced", "built", "critiqued", "committed", "pr-open", "landed"];
    expect(steps.map(stepIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("gives -1 for an unknown value", () => {
    expect(stepIndex("shipped")).toBe(-1);
    expect(stepIndex("")).toBe(-1);
    expect(stepIndex("Landed")).toBe(-1);
  });
});
