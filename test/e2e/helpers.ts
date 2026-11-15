import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { type Answerer, type Item, parse, serialize } from "../../src/schema";

export const VIEW_TYPE = "agents-inbox";
export const ITEM_VIEW_TYPE = "agents-inbox-item";
export const DOC_VIEW_TYPE = "agents-inbox-doc";

export const ROOT_QUESTION = "inbox/root-question.md";
export const ROOT_THREAD = "inbox/root-thread.md";
export const M1_EARLIER = "maps/m1/inbox/m1-earlier.md";
export const M1_NEWER = "maps/m1/inbox/m1-newer.md";
export const M1_ANSWERED = "maps/m1/inbox/m1-answered.md";
export const M1_C2 = "maps/m1/inbox/m1-c2.md";
export const M2_OPEN_QUESTION = "maps/m2/inbox/m2-open-question.md";
export const M2_PICK_MANY = "maps/m2/inbox/m2-pick-many.md";
export const M1_MAP = "maps/m1/map.md";
export const C1_REQUIREMENTS = "maps/m1/c1/requirements.md";
export const C1_DESIGN = "maps/m1/c1/design.md";
export const C1_IMPLEMENTATION = "maps/m1/c1/implementation.md";
export const FIXTURES = [ROOT_QUESTION, ROOT_THREAD, M1_EARLIER, M1_NEWER, M1_ANSWERED, M1_C2, M2_OPEN_QUESTION, M2_PICK_MANY];

const CLI = join(import.meta.dirname, "..", "..", "dist", "inbox.js");
const SIDEBAR = `.workspace-leaf-content[data-type="${VIEW_TYPE}"]`;
const TABS = `.workspace-leaf-content[data-type="${ITEM_VIEW_TYPE}"]`;
const DOCS = `.workspace-leaf-content[data-type="${DOC_VIEW_TYPE}"]`;
const AIDS = ".agents-inbox-concerns, .agents-inbox-outline, .agents-inbox-steps, tr.is-cited, tr.is-item";
const CLOSING_FENCE = "\n---\n";

export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function vault(): string {
  return obsidianPage.getVaultPath();
}

export function inbox(args: string[], input = ""): Result {
  const { status, stdout, stderr } = spawnSync("node", [CLI, ...args], {
    env: { ...process.env, INBOX_DOCS_DIR: vault() },
    input,
    encoding: "utf8",
  });
  return { status, stdout, stderr };
}

export function inboxAsync(args: string[]): Promise<Result> & { exited: () => boolean } {
  const child = spawn("node", [CLI, ...args], { env: { ...process.env, INBOX_DOCS_DIR: vault() } });
  child.stdin.end();
  let stdout = "";
  let stderr = "";
  let done = false;
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const result = new Promise<Result>((resolve) =>
    child.on("close", (status) => {
      done = true;
      resolve({ status, stdout, stderr });
    }),
  );
  return Object.assign(result, { exited: () => done });
}

export function ask(args: string[], body: string): string {
  const result = inbox(["ask", "--kind", "decide", "--from", "e2e · s1", ...args], body);
  if (result.status !== 0) throw new Error(`inbox ask failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function reply(id: string, text: string): void {
  const result = inbox(["reply", id], text);
  if (result.status !== 0) throw new Error(`inbox reply failed: ${result.stderr}`);
}

export function revise(id: string, args: string[]): void {
  const result = inbox(["revise", id, ...args]);
  if (result.status !== 0) throw new Error(`inbox revise failed: ${result.stderr}`);
}

export function revisedText(rel: string, args: string[]): string {
  const docs = mkdtempSync(join(tmpdir(), "inbox-e2e-"));
  try {
    const copy = join(docs, "inbox", basename(rel));
    mkdirSync(dirname(copy));
    writeFileSync(copy, readBytes(rel));
    const result = spawnSync("node", [CLI, "revise", basename(rel, ".md"), ...args], {
      env: { ...process.env, INBOX_DOCS_DIR: docs },
      encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`inbox revise failed: ${result.stderr}`);
    return readFileSync(copy, "utf8");
  } finally {
    rmSync(docs, { recursive: true, force: true });
  }
}

export function writeUnderLock(rel: string, text: string): void {
  const path = join(vault(), rel);
  const tmp = join(dirname(path), `.e2e-${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export async function waitForNotice(pattern: RegExp): Promise<void> {
  await browser.waitUntil(async () => (await $$(".notice").map((notice) => notice.getText())).some((text) => pattern.test(text)), {
    timeoutMsg: `no notice matched ${pattern}`,
  });
}

export function readBytes(rel: string): Buffer {
  return readFileSync(join(vault(), rel));
}

export function bodyBytes(rel: string): Buffer {
  const bytes = readBytes(rel);
  return bytes.subarray(bytes.indexOf(CLOSING_FENCE, 3) + CLOSING_FENCE.length);
}

export function itemAt(rel: string): Item {
  return parse(readFileSync(join(vault(), rel), "utf8"));
}

export function snapshot(): Record<string, string> {
  const root = vault();
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const rel = relative(root, join(entry.parentPath, entry.name)).split(sep).join("/");
    if (rel.startsWith(".obsidian/")) continue;
    const path = join(root, rel);
    files[rel] = `${statSync(path).mtimeMs} ${readFileSync(path, "utf8")}`;
  }
  return files;
}

export function holdLock(rel: string): () => void {
  const lock = `${join(vault(), rel)}.lock`;
  writeFileSync(lock, `${process.pid} ${Date.now()}\n`, { flag: "wx" });
  return () => rmSync(lock, { force: true });
}

function answeredText(rel: string, answer: string, answered_by: Answerer): string {
  const item = itemAt(rel);
  return serialize({ ...item, answer, note: null, answered_by, status: "answered", answered_at: new Date().toISOString() });
}

export function answerUnderLock(rel: string, answer: string, answered_by: Answerer): void {
  writeUnderLock(rel, answeredText(rel, answer, answered_by));
}

export function rewrittenText(rel: string, changes: Partial<Item>): string {
  return serialize({ ...itemAt(rel), ...changes });
}

export async function chatAnswersThenTabClicks(
  rel: string,
  answer: string,
  id: string,
  button: string,
  before: Record<string, string> = {},
): Promise<{ clicked: boolean; text: string }> {
  const path = join(vault(), rel);
  const tmp = join(dirname(path), `.e2e-${process.pid}.tmp`);
  const text = answeredText(rel, answer, "chat");
  const others = Object.entries(before).map(([other, content]): [string, string] => [join(vault(), other), content]);
  const clicked = await browser.executeObsidian(
    (_obsidian, file, temp, content, selector, writes) => {
      const fs = require("fs");
      for (const [other, otherContent] of writes) fs.writeFileSync(other, otherContent);
      fs.writeFileSync(temp, content);
      fs.renameSync(temp, file);
      const target = document.querySelector<HTMLButtonElement>(selector);
      target?.click();
      return target !== null;
    },
    path,
    tmp,
    text,
    `${TABS} .agents-inbox-item[data-id="${id}"] ${button}`,
    others,
  );
  return { clicked, text };
}

export async function waitForObsidianToSee(rel: string, answered_by: Answerer): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.executeObsidian(
        ({ app }, path, by) => app.metadataCache.getCache(path)?.frontmatter?.answered_by === by,
        rel,
        answered_by,
      ),
    { timeoutMsg: `Obsidian never saw ${rel} answered by ${answered_by}` },
  );
}

export async function closeInbox(): Promise<void> {
  await browser.executeObsidian(({ app }, types) => types.forEach((type) => app.workspace.detachLeavesOfType(type)), [
    VIEW_TYPE,
    ITEM_VIEW_TYPE,
    DOC_VIEW_TYPE,
  ]);
}

export async function closeItemTabs(): Promise<void> {
  await browser.executeObsidian(({ app }, type) => app.workspace.detachLeavesOfType(type), ITEM_VIEW_TYPE);
}

export async function saveLayout(): Promise<void> {
  await browser.executeObsidian(({ app }) => app.workspace.requestSaveLayout.run());
}

export function inboxLeaves(): Promise<number> {
  return browser.executeObsidian(({ app }, type) => app.workspace.getLeavesOfType(type).length, VIEW_TYPE);
}

export async function reset(): Promise<void> {
  await closeInbox();
  await obsidianPage.resetVault();
}

export function panel() {
  return $(SIDEBAR);
}

export function list() {
  return $(`${SIDEBAR} .agents-inbox`);
}

export function row(id: string) {
  return $(`${SIDEBAR} .agents-inbox-row[data-id="${id}"]`);
}

export function unreadMark(id: string) {
  return $(`${SIDEBAR} .agents-inbox-row[data-id="${id}"] .agents-inbox-unread`);
}

export function tab(id: string) {
  return $(`${TABS} .agents-inbox-item[data-id="${id}"]`);
}

export function composer(id: string) {
  return tab(id).$("textarea.agents-inbox-composer");
}

export function answerButton(id: string) {
  return tab(id).$("button.agents-inbox-answer");
}

export async function choose(id: string, option: string): Promise<void> {
  await tab(id).$(`.agents-inbox-choice[data-option="${option}"] input`).click();
}

export async function openInbox(): Promise<void> {
  await browser.executeObsidianCommand("agents:open-inbox");
  await browser.waitUntil(async () => (await panel().$$(".agents-inbox-row, .agents-inbox-empty").length) > 0, {
    timeoutMsg: "the inbox panel never rendered",
  });
  await browser.waitUntil(async () => (await panel().isDisplayed()) && (await settled(SIDEBAR)), {
    timeoutMsg: "the inbox panel never settled",
  });
}

export async function dismissNotices(): Promise<void> {
  await browser.execute(() => document.querySelectorAll(".notice").forEach((notice) => notice.remove()));
}

export async function openItem(id: string): Promise<void> {
  await openInbox();
  await dismissNotices();
  await row(id).click();
  const selector = `${TABS} .agents-inbox-item[data-id="${id}"]`;
  await browser.waitUntil(
    async () => (await tab(id).isDisplayed()) && (await tab(id).$$(".agents-inbox-body > *").length) > 0 && (await settled(selector)),
    { timeoutMsg: `the tab for ${id} never settled` },
  );
}

function settled(selector: string): Promise<boolean> {
  return browser.execute(async (target) => {
    const el = document.querySelector<HTMLElement>(target);
    if (!el) return false;
    const rect = () => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return JSON.stringify({ x, y, width, height });
    };
    const frame = () => new Promise<string>((resolve) => requestAnimationFrame(() => resolve(rect())));
    const first = rect();
    return (await frame()) === first && (await frame()) === first;
  }, selector);
}

export function itemTabs(): Promise<{ paths: string[]; active: string | null; inRoot: boolean }> {
  return browser.executeObsidian(({ app }, type) => {
    const leaves = app.workspace.getLeavesOfType(type);
    const pathOf = (state: Record<string, unknown> | undefined) => (typeof state?.path === "string" ? state.path : null);
    return {
      paths: leaves.flatMap((leaf) => pathOf(leaf.getViewState().state) ?? []).sort(),
      active: pathOf(app.workspace.getMostRecentLeaf(app.workspace.rootSplit)?.getViewState().state),
      inRoot: leaves.every((leaf) => leaf.getRoot() === app.workspace.rootSplit),
    };
  }, ITEM_VIEW_TYPE);
}

export async function seenPaths(): Promise<string[]> {
  return await browser.executeObsidian(async ({ plugins }) => Object.keys(((await plugins.agents.loadData()) ?? {}).seen ?? {}));
}

export function rowIds(): Promise<string[]> {
  return browser.execute(
    (sidebar) => [...document.querySelectorAll<HTMLElement>(`${sidebar} .agents-inbox-row[data-id]`)].map((el) => el.dataset.id ?? ""),
    SIDEBAR,
  );
}

export function groupTitles(): Promise<string[]> {
  return browser.execute(
    (sidebar) => [...document.querySelectorAll<HTMLElement>(`${sidebar} .agents-inbox-group-title`)].map((el) => el.textContent ?? ""),
    SIDEBAR,
  );
}

export function rowGroups(): Promise<{ id: string; group: string }[]> {
  return browser.execute(
    (sidebar) =>
      [...document.querySelectorAll<HTMLElement>(`${sidebar} .agents-inbox-row[data-id]`)].map((el) => ({
        id: el.dataset.id ?? "",
        group: el.closest(".agents-inbox-group")?.querySelector(".agents-inbox-group-title")?.textContent ?? "",
      })),
    SIDEBAR,
  );
}

export function choicesOf(id: string): Promise<{ option: string; type: string; recommended: boolean }[]> {
  return browser.execute(
    (target) =>
      [...document.querySelectorAll<HTMLElement>(`${target} .agents-inbox-choice`)].map((el) => ({
        option: el.dataset.option ?? "",
        type: el.querySelector("input")?.type ?? "",
        recommended: el.classList.contains("is-recommended"),
      })),
    `${TABS} .agents-inbox-item[data-id="${id}"]`,
  );
}

export function checkedOf(id: string): Promise<string[]> {
  return browser.execute(
    (target) => [...document.querySelectorAll<HTMLInputElement>(`${target} .agents-inbox-choice input:checked`)].map((input) => input.value),
    `${TABS} .agents-inbox-item[data-id="${id}"]`,
  );
}

export function authorsOf(id: string): Promise<string[]> {
  return browser.execute(
    (target) => [...document.querySelectorAll<HTMLElement>(`${target} .agents-inbox-message`)].map((el) => el.dataset.author ?? ""),
    `${TABS} .agents-inbox-item[data-id="${id}"]`,
  );
}

export const ANSWERING_CONTROLS =
  "button.agents-inbox-send, button.agents-inbox-answer, .agents-inbox-choice input, textarea.agents-inbox-note, textarea.agents-inbox-composer:not([readonly])";

export async function expectNoAnsweringControls(el: ReturnType<typeof $>): Promise<void> {
  await expect(el.$$(ANSWERING_CONTROLS)).toBeElementsArrayOfSize(0);
}

export async function expectNoControls(el: ReturnType<typeof $>): Promise<void> {
  await expect(el.$$("button, input, textarea, select")).toBeElementsArrayOfSize(0);
}

export async function markWindow(): Promise<void> {
  await browser.execute(() => {
    document.body.dataset.agentsE2e = "kept";
  });
}

export function windowKept(): Promise<boolean> {
  return browser.execute(() => document.body.dataset.agentsE2e === "kept");
}

export async function markTab(id: string): Promise<void> {
  await browser.execute(
    (target) => {
      const el = document.querySelector<HTMLElement>(target);
      if (el) el.dataset.agentsE2e = "kept";
    },
    `${TABS} .agents-inbox-item[data-id="${id}"]`,
  );
}

export function tabKept(id: string): Promise<boolean> {
  return browser.execute(
    (target) => document.querySelector<HTMLElement>(target)?.dataset.agentsE2e === "kept",
    `${TABS} .agents-inbox-item[data-id="${id}"]`,
  );
}

export async function markComposer(id: string): Promise<void> {
  await browser.execute(
    (target) => {
      const el = document.querySelector<HTMLElement>(target);
      if (el) el.dataset.agentsE2e = "kept";
    },
    `${TABS} .agents-inbox-item[data-id="${id}"] textarea.agents-inbox-composer`,
  );
}

export function composerState(id: string): Promise<{ kept: boolean; focused: boolean; value: string | null }> {
  return browser.execute(
    (target) => {
      const el = document.querySelector<HTMLTextAreaElement>(target);
      return {
        kept: el?.dataset.agentsE2e === "kept",
        focused: el !== null && document.activeElement === el,
        value: el?.value ?? null,
      };
    },
    `${TABS} .agents-inbox-item[data-id="${id}"] textarea.agents-inbox-composer`,
  );
}

export function searchBox() {
  return $(`${SIDEBAR} .agents-inbox-toolbar .search-input-container input`);
}

export async function search(text: string): Promise<void> {
  await searchBox().setValue(text);
}

export function header(): Promise<string> {
  return browser.execute(
    (sidebar) => [...document.querySelectorAll<HTMLElement>(`${sidebar} .agents-inbox-header > span`)].map((el) => el.textContent ?? "").join(" "),
    SIDEBAR,
  );
}

export function snippet(id: string) {
  return row(id).$(".agents-inbox-row-snippet");
}

export function location(id: string) {
  return row(id).$(".agents-inbox-row-location");
}

export function noMatch() {
  return panel().$(".agents-inbox-no-match");
}

export function chips(): Promise<string[]> {
  return browser.execute(
    (sidebar) => [...document.querySelectorAll<HTMLElement>(`${sidebar} .agents-inbox-chip-label`)].map((el) => el.textContent ?? ""),
    SIDEBAR,
  );
}

export async function removeChip(section: "state" | "kind" | "map"): Promise<void> {
  await panel().$(`.agents-inbox-chip[data-section="${section}"] .agents-inbox-chip-remove`).click();
}

async function openMenu(button: "filter" | "group"): Promise<void> {
  await panel().$(`.agents-inbox-${button}-button`).click();
  await $(".menu").waitForDisplayed({ timeoutMsg: `the ${button} menu never opened` });
}

export async function pick(button: "filter" | "group", label: string): Promise<void> {
  await openMenu(button);
  const item = $(
    `//div[contains(concat(" ", normalize-space(@class), " "), " menu-item ")][.//span[contains(@class, "agents-inbox-menu-label") and normalize-space(.)="${label}"]]`,
  );
  await item.click();
  await $(".menu").waitForExist({ reverse: true, timeoutMsg: `the ${button} menu stayed open after ${label}` });
}

export async function arrange(groupBy: string, sort: string): Promise<void> {
  await pick("group", groupBy);
  await pick("group", sort);
}

export async function filterCounts(): Promise<Record<string, number>> {
  await openMenu("filter");
  const counts = await browser.execute(() =>
    Object.fromEntries(
      [...document.querySelectorAll(".menu .menu-item")].flatMap((el) => {
        const label = el.querySelector(".agents-inbox-menu-label")?.textContent;
        const count = el.querySelector(".agents-inbox-menu-count")?.textContent;
        return label == null || count == null ? [] : [[label, Number(count)]];
      }),
    ),
  );
  await browser.keys("Escape");
  await $(".menu").waitForExist({ reverse: true, timeoutMsg: "the filter menu stayed open" });
  return counts;
}

export async function savedSidebar(): Promise<unknown> {
  return await browser.executeObsidian(async ({ plugins }) => ((await plugins.agents.loadData()) ?? {}).sidebar ?? null);
}

export async function pluginDataFile(): Promise<string> {
  const dir = await browser.executeObsidian(({ plugins }) => plugins.agents.manifest.dir as string);
  return join(vault(), dir, "data.json");
}

export type DocKind = "map" | "requirements" | "design" | "implementation";

export interface Context {
  where: string | null;
  links: string[];
}

export function contextOf(id: string): Promise<Context | null> {
  return browser.execute((target) => {
    const bar = document.querySelector<HTMLElement>(`${target} .agents-inbox-context`);
    if (bar === null) return null;
    return {
      where: bar.querySelector(".agents-inbox-context-where")?.textContent ?? null,
      links: [...bar.querySelectorAll<HTMLElement>(".agents-inbox-context-link")].map((el) => el.textContent ?? ""),
    };
  }, `${TABS} .agents-inbox-item[data-id="${id}"]`);
}

export async function waitForContext(id: string, expected: Context | null): Promise<void> {
  const ordered = (context: Context | null) => JSON.stringify(context && { where: context.where, links: context.links });
  const want = ordered(expected);
  let seen = "";
  try {
    await browser.waitUntil(async () => {
      seen = ordered(await contextOf(id));
      return seen === want;
    });
  } catch {
    throw new Error(`the context bar of ${id} never read ${want}; last ${seen}`);
  }
}

export async function clickContext(id: string, kind: DocKind): Promise<void> {
  await tab(id).$(`.agents-inbox-context-link[data-kind="${kind}"]`).click();
}

export function citation(id: string, href: string) {
  return tab(id).$(`a.internal-link[data-href="${href}"]`);
}

export function docView() {
  return $(`${DOCS} .agents-inbox-doc`);
}

export async function waitForDoc(path: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (target, want) => document.querySelector<HTMLElement>(target)?.dataset.path === want,
        `${DOCS} .agents-inbox-doc`,
        path,
      ),
    { timeoutMsg: `the split never showed ${path}` },
  );
}

export function splitState(): Promise<{ docs: { path: unknown; itemPath: unknown }[]; beside: boolean }> {
  return browser.executeObsidian(
    ({ app }, docType, itemType) => {
      type Node = { parent?: Node; direction?: string };
      const docs = app.workspace.getLeavesOfType(docType);
      const items = app.workspace.getLeavesOfType(itemType);
      const beside = docs.every((doc) =>
        items.some((item) => {
          const docNode = doc as unknown as Node;
          const itemNode = item as unknown as Node;
          const split = docNode.parent?.parent;
          return (
            doc.getRoot() === app.workspace.rootSplit &&
            docNode.parent !== itemNode.parent &&
            split !== undefined &&
            split === itemNode.parent?.parent &&
            split.direction === "vertical"
          );
        }),
      );
      return {
        docs: docs.map((leaf) => {
          const state = leaf.getViewState().state ?? {};
          return { path: state.path, itemPath: state.itemPath };
        }),
        beside,
      };
    },
    DOC_VIEW_TYPE,
    ITEM_VIEW_TYPE,
  );
}

export async function markDocLeaf(): Promise<void> {
  await browser.execute((target) => {
    const leaf = document.querySelector(target)?.closest<HTMLElement>(".workspace-leaf");
    if (leaf) leaf.dataset.agentsE2e = "kept";
  }, DOCS);
}

export function docLeafKept(): Promise<boolean> {
  return browser.execute((target) => document.querySelector(target)?.closest<HTMLElement>(".workspace-leaf")?.dataset.agentsE2e === "kept", DOCS);
}

export function docScroll(heading: string): Promise<{ scrollTop: number; offset: number | null }> {
  return browser.execute(
    (target, text) => {
      const scroller = document.querySelector<HTMLElement>(`${target} .agents-inbox-doc-scroll`);
      if (scroller === null) return { scrollTop: -1, offset: null };
      const found = [...scroller.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")].find((el) => el.textContent?.trim() === text);
      return {
        scrollTop: scroller.scrollTop,
        offset: found === undefined ? null : found.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
      };
    },
    DOCS,
    heading,
  );
}

export async function waitForHeadingAtTop(heading: string): Promise<void> {
  let seen = "";
  await browser.waitUntil(
    async () => {
      const { scrollTop, offset } = await docScroll(heading);
      seen = JSON.stringify({ scrollTop, offset });
      return scrollTop > 0 && offset !== null && Math.abs(offset) < 2;
    },
    { timeoutMsg: `the split never scrolled to ${heading}; last ${seen}` },
  );
}

export async function hoverPreview(text: string): Promise<void> {
  await browser.waitUntil(
    async () => (await $$(".popover.hover-popover").map((popover) => popover.getText())).some((shown) => shown.includes(text)),
    { timeoutMsg: `no hover preview showed ${text}` },
  );
}

export function concernRows(): Promise<{ concern: string; item: boolean; cells: string[] }[]> {
  return browser.execute(
    (target) =>
      [...document.querySelectorAll<HTMLElement>(`${target} .agents-inbox-concerns tbody tr`)].map((tr) => ({
        concern: tr.dataset.concern ?? "",
        item: tr.classList.contains("is-item"),
        cells: [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
      })),
    DOCS,
  );
}

export function citedRows(): Promise<string[]> {
  return browser.execute(
    (target) => [...document.querySelectorAll<HTMLElement>(`${target} tr.is-cited`)].map((tr) => tr.querySelector("td")?.textContent ?? ""),
    DOCS,
  );
}

export function outlineEntries(): Promise<string[]> {
  return browser.execute(
    (target) => [...document.querySelectorAll<HTMLElement>(`${target} .agents-inbox-outline-entry`)].map((el) => el.textContent ?? ""),
    DOCS,
  );
}

export async function clickOutline(heading: string): Promise<void> {
  const entry = await $$(`${DOCS} .agents-inbox-outline-entry`).find(async (el) => (await el.getText()) === heading);
  if (entry === undefined) throw new Error(`no outline entry reads ${heading}`);
  await entry.click();
}

export function steps(): Promise<{ step: string; done: boolean; current: boolean }[]> {
  return browser.execute(
    (target) =>
      [...document.querySelectorAll<HTMLElement>(`${target} .agents-inbox-step`)].map((el) => ({
        step: el.textContent ?? "",
        done: el.classList.contains("is-done"),
        current: el.classList.contains("is-current"),
      })),
    DOCS,
  );
}

export function aidsInSplit(): Promise<number> {
  return browser.execute((target, aids) => document.querySelectorAll(`${target} :is(${aids})`).length, DOCS, AIDS);
}

export async function closeMarkdownTabs(): Promise<void> {
  await browser.executeObsidian(({ app }) => app.workspace.detachLeavesOfType("markdown"));
}

export function markdownTabs(): Promise<string[]> {
  return browser.executeObsidian(({ app, obsidian }) =>
    app.workspace
      .getLeavesOfType("markdown")
      .flatMap((leaf) => (leaf.view instanceof obsidian.MarkdownView && leaf.view.file !== null ? [leaf.view.file.path] : []))
      .sort(),
  );
}

export async function openOutsideSplit(path: string, mode: "preview" | "source", shows: string): Promise<void> {
  await closeMarkdownTabs();
  await browser.executeObsidian(
    async ({ app }, file, viewMode) => {
      const leaf = app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "markdown", state: { file, mode: viewMode }, active: true });
    },
    path,
    mode,
  );
  await browser.waitUntil(
    () =>
      browser.execute(
        (text) =>
          [...document.querySelectorAll<HTMLElement>('.workspace-leaf-content[data-type="markdown"]')].some((el) => el.innerText.includes(text)),
        shows,
      ),
    { timeoutMsg: `${path} never rendered in ${mode} mode` },
  );
}

export function aidsOutsideSplit(): Promise<number> {
  return browser.execute(
    (aids) => document.querySelectorAll(`.workspace-leaf-content[data-type="markdown"] :is(${aids})`).length,
    AIDS,
  );
}
