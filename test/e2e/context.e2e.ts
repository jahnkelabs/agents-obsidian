import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import {
  answerButton,
  aidsInSplit,
  ask,
  C1_DESIGN,
  C1_IMPLEMENTATION,
  C1_REQUIREMENTS,
  DOC_VIEW_TYPE,
  citation,
  clickContext,
  closeMarkdownTabs,
  composer,
  dismissNotices,
  docLeafKept,
  docScroll,
  docView,
  hoverPreview,
  itemTabs,
  M1_NEWER,
  markDocLeaf,
  markdownTabs,
  markTab,
  openItem,
  outlineEntries,
  reply,
  reset,
  snapshot,
  splitState,
  steps,
  tab,
  tabKept,
  vault,
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

describe("the split while its document or its state changes", () => {
  beforeEach(async () => {
    await reset();
    await closeMarkdownTabs();
  });

  it("scrolls to a nested heading a citation names as a chain", async () => {
    const id = ask(["--map", "m1", "--concern", "c1", "--option", "a", "--option", "b"], "**Deciding — nested**\n\nSee [[c1/design#Failure handling#Scope]].\n");
    await openItem(id);
    await citation(id, "c1/design#Failure handling#Scope").click();
    await waitForDoc(C1_DESIGN);
    await waitForHeadingAtTop("Scope");
  });

  it("follows the open document when it is renamed, and shows the missing state when it is deleted", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "design");
    await waitForDoc(C1_DESIGN);
    await browser.executeObsidian(async ({ app }, from, to) => {
      const file = app.vault.getFileByPath(from);
      if (file !== null) await app.vault.rename(file, to);
    }, C1_DESIGN, "maps/m1/c1/design-v1.md");
    await waitForDoc("maps/m1/c1/design-v1.md");
    await expect(docView().$(".agents-inbox-doc-missing")).not.toBeExisting();
    expect(await outlineEntries()).toContain("Data model");

    rmSync(join(vault(), "maps/m1/c1/design-v1.md"));
    await docView().$(".agents-inbox-doc-missing-title").waitForExist();
    await expect(docView().$(".agents-inbox-doc-missing-title")).toHaveText("This document no longer exists");
    await expect(docView().$(".agents-inbox-doc-missing-path")).toHaveText("maps/m1/c1/design-v1.md");
    await expect(docView().$(".agents-inbox-doc-open")).not.toBeDisplayed();
    expect((await splitState()).docs).toHaveLength(1);
  });

  it("opens the shown document in Obsidian's own view from Open in editor, and keeps the split", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "design");
    await waitForDoc(C1_DESIGN);
    await docView().$(".agents-inbox-doc-open").click();
    await browser.waitUntil(async () => (await markdownTabs()).includes(C1_DESIGN), {
      timeoutMsg: "Open in editor never opened the design in a markdown tab",
    });
    expect((await splitState()).docs).toEqual([{ path: C1_DESIGN, itemPath: M1_NEWER }]);
  });

  it("shows no aid for an unknown step or a malformed type", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "implementation");
    await waitForDoc(C1_IMPLEMENTATION);
    expect(await steps()).toHaveLength(7);

    const path = join(vault(), C1_IMPLEMENTATION);
    writeFileSync(path, "---\ntype: implementation\nstep: shipped\n---\n## Where the code is\n\nShipped text.\n");
    await docView().$("p=Shipped text.").waitForExist();
    expect(await aidsInSplit()).toBe(0);

    writeFileSync(path, "---\ntype: [\n---\n## Where the code is\n\nMalformed text.\n");
    await docView().$("p=Malformed text.").waitForExist();
    expect(await aidsInSplit()).toBe(0);
  });

  it("reuses the item's split after Obsidian reloads the workspace layout", async () => {
    await openItem("m1-newer");
    await clickContext("m1-newer", "design");
    await waitForDoc(C1_DESIGN);
    await browser.executeObsidian(async ({ app }) => {
      await app.workspace.changeLayout(app.workspace.getLayout());
    });
    await waitForContext("m1-newer", { where: "m1 / c1", links: ["Map", "Requirements", "Design · open", "Implementation"] });
    await clickContext("m1-newer", "requirements");
    await waitForDoc(C1_REQUIREMENTS);
    expect(await splitState()).toEqual({ docs: [{ path: C1_REQUIREMENTS, itemPath: M1_NEWER }], beside: true });
    expect(await browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length, DOC_VIEW_TYPE)).toBe(1);
  });
});
