import { browser, expect } from "@wdio/globals";
import {
  answerButton,
  ask,
  C1_DESIGN,
  C1_IMPLEMENTATION,
  C1_REQUIREMENTS,
  citation,
  clickContext,
  closeMarkdownTabs,
  composer,
  dismissNotices,
  docLeafKept,
  docScroll,
  hoverPreview,
  itemTabs,
  M1_NEWER,
  markDocLeaf,
  markdownTabs,
  markTab,
  openItem,
  reply,
  reset,
  snapshot,
  splitState,
  tab,
  tabKept,
  waitForContext,
  waitForDoc,
  waitForHeadingAtTop,
  waitForNotice,
} from "./helpers";

const CITED = [
  "**Deciding — cited documents**",
  "",
  "The parts are in [[c1/design#Interfaces]], and the row is [[c1/requirements#Acceptance criteria|criterion 2]].",
  "",
  "Gone: [[c1/design#Gone]]. Missing: [[c1/nothing]]. Outside: [[README]].",
  "",
].join("\n");

describe("an item's map context", () => {
  beforeEach(async () => {
    await reset();
    await closeMarkdownTabs();
  });

  it("names the map and concern above the tab, links each document that exists, and shows no bar for an item with no map", async () => {
    await openItem("m1-newer");
    await waitForContext("m1-newer", { where: "m1 / c1", links: ["Map", "Requirements", "Design", "Implementation"] });
    await expect(tab("m1-newer").$$(".agents-inbox-choice")).toBeElementsArrayOfSize(2);
    await expect(composer("m1-newer")).toBeDisplayed();
    await expect(answerButton("m1-newer")).toBeDisplayed();

    await openItem("m1-c2");
    await waitForContext("m1-c2", { where: "m1 / c2", links: ["Map"] });

    const id = ask(["--map", "m1", "--option", "a", "--option", "b"], "**Deciding — map only**\n");
    await openItem(id);
    await waitForContext(id, { where: "m1", links: ["Map"] });

    await openItem("root-question");
    await waitForContext("root-question", null);
  });

  it("opens a bar link in a split beside the item, replaces it in that split on a second link, and marks the open document", async () => {
    reply("m1-newer", "Read the design first.\n");
    await openItem("m1-newer");
    await markTab("m1-newer");

    await clickContext("m1-newer", "design");
    await waitForDoc(C1_DESIGN);
    expect(await splitState()).toEqual({ docs: [{ path: C1_DESIGN, itemPath: M1_NEWER }], beside: true });
    await waitForContext("m1-newer", { where: "m1 / c1", links: ["Map", "Requirements", "Design · open", "Implementation"] });
    expect(await itemTabs()).toEqual({ paths: [M1_NEWER], active: M1_NEWER, inRoot: true });

    await markDocLeaf();
    await clickContext("m1-newer", "requirements");
    await waitForDoc(C1_REQUIREMENTS);
    expect(await splitState()).toEqual({ docs: [{ path: C1_REQUIREMENTS, itemPath: M1_NEWER }], beside: true });
    expect(await docLeafKept()).toBe(true);
    await waitForContext("m1-newer", { where: "m1 / c1", links: ["Map", "Requirements · open", "Design", "Implementation"] });

    expect(await itemTabs()).toEqual({ paths: [M1_NEWER], active: M1_NEWER, inRoot: true });
    expect(await tabKept("m1-newer")).toBe(true);
    await expect(tab("m1-newer").$$(".agents-inbox-message")).toBeElementsArrayOfSize(1);
    await expect(tab("m1-newer").$$(".agents-inbox-choice")).toBeElementsArrayOfSize(2);
    await expect(composer("m1-newer")).toBeDisplayed();
  });

  it("opens a citation from the body or the thread in the split at its heading, previews it on hover, and changes no file", async () => {
    const id = ask(["--map", "m1", "--concern", "c1", "--option", "a", "--option", "b"], CITED);
    const rel = `maps/m1/inbox/${id}.md`;
    reply(id, "The slices are in [[c1/implementation#Slices]].\n");
    await openItem(id);
    await tab(id).$(".agents-inbox-message a.internal-link").waitForExist();
    await markTab(id);
    const before = snapshot();

    await citation(id, "c1/design#Interfaces").click();
    await waitForDoc(C1_DESIGN);
    await waitForHeadingAtTop("Interfaces");
    await waitForContext(id, { where: "m1 / c1", links: ["Map", "Requirements", "Design · open", "Implementation"] });

    await tab(id).$('.agents-inbox-message a.internal-link[data-href="c1/implementation#Slices"]').click();
    await waitForDoc(C1_IMPLEMENTATION);
    expect(await splitState()).toEqual({ docs: [{ path: C1_IMPLEMENTATION, itemPath: rel }], beside: true });

    await citation(id, "c1/design#Gone").click();
    await waitForDoc(C1_DESIGN);
    expect(await docScroll("Interfaces")).toEqual({ scrollTop: 0, offset: expect.any(Number) });

    await citation(id, "c1/nothing").click();
    await waitForNotice(/^Inbox: no document for c1\/nothing$/);
    await dismissNotices();
    expect(await splitState()).toEqual({ docs: [{ path: C1_DESIGN, itemPath: rel }], beside: true });

    await citation(id, "README").click();
    await browser.waitUntil(async () => (await markdownTabs()).includes("README.md"), {
      timeoutMsg: "a link outside the map never opened in Obsidian's own view",
    });
    expect(await splitState()).toEqual({ docs: [{ path: C1_DESIGN, itemPath: rel }], beside: true });

    await openItem(id);
    await citation(id, "c1/design#Interfaces").moveTo();
    await hoverPreview("Interfaces, point 1");

    expect(await tabKept(id)).toBe(true);
    expect((await itemTabs()).paths).toEqual([rel]);
    expect(snapshot()).toEqual(before);
  });
});
