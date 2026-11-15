import { describe, expect, it } from "vitest";
import { citedRow, contextDocs, designOutline, parseCitation, stepIndex } from "../src/plugin/context";

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
    expect(asked).toEqual([
      "maps/m1/map.md",
      "maps/m1/c1/requirements.md",
      "maps/m1/c1/design.md",
      "maps/m1/c1/implementation.md",
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

describe("citedRow", () => {
  const REQUIREMENTS = [
    "---",
    "type: requirements",
    "---",
    "## Outcome",
    "",
    "| not | this |",
    "|---|---|",
    "| x | y |",
    "",
    "## Acceptance criteria",
    "",
    "Intro line.",
    "",
    "| Criterion | Proof |",
    "|---|---|",
    "| first | a |",
    "| second | b |",
    "| third | c |",
    "",
    "| Later | table |",
    "|---|---|",
    "| one | two |",
    "",
    "## Constraints",
    "",
    "| Rule | Why |",
    "|---|---|",
    "| r1 | w1 |",
  ].join("\n");

  it("returns the row when it lies within the first table under the heading", () => {
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", 1)).toBe(1);
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", 2)).toBe(2);
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", 3)).toBe(3);
  });

  it("returns null for a row outside the table", () => {
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", 4)).toBeNull();
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", 0)).toBeNull();
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", -1)).toBeNull();
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", 1.5)).toBeNull();
  });

  it("reads the table under the named heading, not an earlier or later one", () => {
    expect(citedRow(REQUIREMENTS, "Constraints", 1)).toBe(1);
    expect(citedRow(REQUIREMENTS, "Constraints", 2)).toBeNull();
    expect(citedRow(REQUIREMENTS, "Outcome", 1)).toBe(1);
  });

  it("returns null when there is no cited row or no heading", () => {
    expect(citedRow(REQUIREMENTS, "Acceptance criteria", null)).toBeNull();
    expect(citedRow(REQUIREMENTS, null, 1)).toBeNull();
  });

  it("returns null when the heading does not exist", () => {
    expect(citedRow(REQUIREMENTS, "Removed section", 1)).toBeNull();
  });

  it("matches the heading ignoring case and outer space", () => {
    expect(citedRow(REQUIREMENTS, "  acceptance CRITERIA ", 2)).toBe(2);
  });

  it("returns null when the heading holds no table", () => {
    const text = "## Notes\n\nplain text, a | pipe, and no table\n\n## Next\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    expect(citedRow(text, "Notes", 1)).toBeNull();
  });

  it("returns null for a table with a header and no data rows", () => {
    expect(citedRow("## T\n\n| a | b |\n|---|---|\n", "T", 1)).toBeNull();
  });

  it("finds a table in a deeper section under the heading", () => {
    const text = "## Top\n\n### Sub\n\n| a |\n|---|\n| 1 |\n| 2 |\n";
    expect(citedRow(text, "Top", 2)).toBe(2);
  });

  it("stops at the next heading of the same or a higher level", () => {
    const text = "### Low\n\nno table\n\n## High\n\n| a |\n|---|\n| 1 |\n";
    expect(citedRow(text, "Low", 1)).toBeNull();
  });

  it("ignores a heading and a table inside a code fence", () => {
    const text = ["```md", "## Acceptance criteria", "| a |", "|---|", "| 1 |", "```", "", "## Acceptance criteria", "", "| a |", "|---|", "| 1 |", "| 2 |"].join("\n");
    expect(citedRow(text, "Acceptance criteria", 2)).toBe(2);
    const onlyFenced = ["## Docs", "", "```", "| a |", "|---|", "| 1 |", "```"].join("\n");
    expect(citedRow(onlyFenced, "Docs", 1)).toBeNull();
  });

  it("reads Windows line endings", () => {
    expect(citedRow("## T\r\n\r\n| a |\r\n|---|\r\n| 1 |\r\n| 2 |\r\n", "T", 2)).toBe(2);
  });

  it("ignores a heading lookalike inside the frontmatter", () => {
    const text = "---\n## T\n---\n\n## Other\n\n| a |\n|---|\n| 1 |\n";
    expect(citedRow(text, "T", 1)).toBeNull();
  });

  it("returns null for a block reference subpath", () => {
    expect(citedRow(REQUIREMENTS, "^row2", 2)).toBeNull();
  });
});

describe("designOutline", () => {
  it("lists the level-2 headings in order", () => {
    const text = "# Title\n\n## Structure\n\ntext\n\n### Detail\n\n## Data model\n\n#### Deep\n\n## Interfaces\n";
    expect(designOutline(text)).toEqual(["Structure", "Data model", "Interfaces"]);
  });

  it("ignores a heading inside a code fence", () => {
    const text = ["## Structure", "", "```ts", "## not a heading", "```", "", "~~~", "## nor this", "~~~", "", "## Interfaces"].join("\n");
    expect(designOutline(text)).toEqual(["Structure", "Interfaces"]);
  });

  it("keeps a heading that follows an unclosed fence out of the outline", () => {
    expect(designOutline("## One\n\n```\n## Two\n")).toEqual(["One"]);
  });

  it("closes a fence only on a matching fence of equal or greater length", () => {
    const text = ["````", "```", "## inside", "```", "````", "## Out"].join("\n");
    expect(designOutline(text)).toEqual(["Out"]);
  });

  it("skips the frontmatter", () => {
    expect(designOutline("---\ntype: design\n## odd\n---\n## Structure\n")).toEqual(["Structure"]);
  });

  it("strips closing hashes and outer space, and keeps a # inside the text", () => {
    expect(designOutline("##   Interfaces  ##\n## C# notes\n")).toEqual(["Interfaces", "C# notes"]);
  });

  it("ignores text that only looks like a level-2 heading", () => {
    expect(designOutline("##NoSpace\n    ## indented code\n#\n## \nplain ## text\n")).toEqual([]);
  });

  it("returns an empty list for a document with no level-2 heading", () => {
    expect(designOutline("")).toEqual([]);
    expect(designOutline("# Only\n\n### Third\n")).toEqual([]);
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
