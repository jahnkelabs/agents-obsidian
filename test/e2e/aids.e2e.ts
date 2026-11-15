import { expect } from "@wdio/globals";
import {
  aidsInSplit,
  aidsOutsideSplit,
  ask,
  C1_DESIGN,
  C1_IMPLEMENTATION,
  C1_REQUIREMENTS,
  citation,
  citedRows,
  clickContext,
  clickOutline,
  closeInbox,
  closeMarkdownTabs,
  concernRows,
  docView,
  M1_MAP,
  openItem,
  openOutsideSplit,
  outlineEntries,
  reset,
  steps,
  waitForDoc,
  waitForHeadingAtTop,
} from "./helpers";

const C1_ROW = ["1", "c1", "The first fixture concern, with all four documents", "", "implementing"];
const C2_ROW = ["2", "c2", "The second fixture concern, with no documents yet", "c1", "open"];
const OUTLINE = ["Structure", "Data model", "Interfaces", "Failure handling", "Decisions"];
const STEPS = ["not started", "sliced", "built", "critiqued", "committed", "pr-open", "landed"];

describe("reading aids in the split", () => {
  beforeEach(async () => {
    await reset();
    await closeMarkdownTabs();
  });

  it("renders the map's concerns as a table that tints the item's concern row", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "map");
    await waitForDoc(M1_MAP);
    expect(await concernRows()).toEqual([
      { concern: "c1", item: true, cells: C1_ROW },
      { concern: "c2", item: false, cells: C2_ROW },
    ]);
    await expect(docView().$$("code.language-base, .block-language-base")).toBeElementsArrayOfSize(0);

    await closeInbox();
    await openItem("m1-c2");
    await clickContext("m1-c2", "map");
    await waitForDoc(M1_MAP);
    expect(await concernRows()).toEqual([
      { concern: "c1", item: false, cells: C1_ROW },
      { concern: "c2", item: true, cells: C2_ROW },
    ]);
  });

  it("tints the requirements row a citation names, and no row when the split opens from the bar", async () => {
    const id = ask(
      ["--map", "m1", "--concern", "c1", "--option", "a", "--option", "b"],
      "**Deciding — cited row**\n\nSee [[c1/requirements#Acceptance criteria|criterion 2]].\n",
    );
    await openItem(id);
    await citation(id, "c1/requirements#Acceptance criteria").click();
    await waitForDoc(C1_REQUIREMENTS);
    expect(await citedRows()).toEqual(["Criterion two: the split tints this row"]);

    await clickContext(id, "design");
    await waitForDoc(C1_DESIGN);
    await clickContext(id, "requirements");
    await waitForDoc(C1_REQUIREMENTS);
    expect(await citedRows()).toEqual([]);
  });

  it("shows the design's outline strip, and each entry scrolls the split to its part", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "design");
    await waitForDoc(C1_DESIGN);
    expect(await outlineEntries()).toEqual(OUTLINE);

    await clickOutline("Failure handling");
    await waitForHeadingAtTop("Failure handling");
    await clickOutline("Data model");
    await waitForHeadingAtTop("Data model");
  });

  it("shows the implementation's step strip, marking its step", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "implementation");
    await waitForDoc(C1_IMPLEMENTATION);
    expect(await steps()).toEqual(
      STEPS.map((step, index) => ({ step, done: index < STEPS.indexOf("built"), current: step === "built" })),
    );
  });

  it("shows no aid when the same documents open outside the split", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "implementation");
    await waitForDoc(C1_IMPLEMENTATION);
    expect(await aidsInSplit()).toBeGreaterThan(0);

    const shown: [string, string][] = [
      [M1_MAP, "Decisions so far"],
      [C1_REQUIREMENTS, "Criterion two: the split tints this row"],
      [C1_DESIGN, "Structure, point 1"],
      [C1_IMPLEMENTATION, "Where the code is"],
    ];
    for (const [path, text] of shown) {
      for (const mode of ["preview", "source"] as const) {
        await openOutsideSplit(path, mode, text);
        expect(await aidsOutsideSplit()).toBe(0);
      }
    }
  });
});
