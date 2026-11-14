import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { $, browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { type Answerer, type Item, parse, serialize } from "../../src/schema";

export const VIEW_TYPE = "agents-inbox";

export const ROOT_QUESTION = "inbox/root-question.md";
export const M1_EARLIER = "maps/m1/inbox/m1-earlier.md";
export const M1_NEWER = "maps/m1/inbox/m1-newer.md";
export const M1_ANSWERED = "maps/m1/inbox/m1-answered.md";
export const M1_C2 = "maps/m1/inbox/m1-c2.md";
export const M2_OPEN_QUESTION = "maps/m2/inbox/m2-open-question.md";
export const FIXTURES = [ROOT_QUESTION, M1_EARLIER, M1_NEWER, M1_ANSWERED, M1_C2, M2_OPEN_QUESTION];

const CLI = join(import.meta.dirname, "..", "..", "dist", "inbox.js");

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

export function readBytes(rel: string): Buffer {
  return readFileSync(join(vault(), rel));
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
  const path = join(vault(), rel);
  const tmp = join(dirname(path), `.e2e-${process.pid}.tmp`);
  writeFileSync(tmp, answeredText(rel, answer, answered_by));
  renameSync(tmp, path);
}

export function rewrittenText(rel: string, changes: Partial<Item>): string {
  return serialize({ ...itemAt(rel), ...changes });
}

export async function chatAnswersThenPanelClicks(
  rel: string,
  answer: string,
  id: string,
  option: string,
  before: Record<string, string> = {},
): Promise<{ clicked: boolean; text: string }> {
  const path = join(vault(), rel);
  const tmp = join(dirname(path), `.e2e-${process.pid}.tmp`);
  const text = answeredText(rel, answer, "chat");
  const others = Object.entries(before).map(([other, content]): [string, string] => [join(vault(), other), content]);
  const clicked = await browser.executeObsidian(
    (_obsidian, file, temp, content, type, cardId, choice, writes) => {
      const fs = require("fs");
      for (const [other, otherContent] of writes) fs.writeFileSync(other, otherContent);
      fs.writeFileSync(temp, content);
      fs.renameSync(temp, file);
      const button = document.querySelector<HTMLButtonElement>(
        `.workspace-leaf-content[data-type="${type}"] .agents-inbox-card[data-id="${cardId}"] button[data-option="${choice}"]`,
      );
      button?.click();
      return button !== null;
    },
    path,
    tmp,
    text,
    VIEW_TYPE,
    id,
    option,
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
  await browser.executeObsidian(({ app }, type) => app.workspace.detachLeavesOfType(type), VIEW_TYPE);
}

export async function reset(): Promise<void> {
  await closeInbox();
  await obsidianPage.resetVault();
}

export function panel() {
  return $(`.workspace-leaf-content[data-type="${VIEW_TYPE}"]`);
}

export function card(id: string) {
  return panel().$(`.agents-inbox-card[data-id="${id}"]`);
}

export async function openInbox(): Promise<void> {
  await browser.executeObsidianCommand("agents:open-inbox");
  await browser.waitUntil(async () => (await panel().$$(".agents-inbox-card, .agents-inbox-empty").length) > 0, {
    timeoutMsg: "the inbox panel never rendered",
  });
  await browser.waitUntil(async () => (await panel().isDisplayed()) && (await panelSettled()), {
    timeoutMsg: "the inbox panel never settled",
  });
}

function panelSettled(): Promise<boolean> {
  return browser.execute(async (type) => {
    const el = document.querySelector<HTMLElement>(`.workspace-leaf-content[data-type="${type}"]`);
    if (!el) return false;
    const rect = () => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return JSON.stringify({ x, y, width, height });
    };
    const frame = () => new Promise<string>((resolve) => requestAnimationFrame(() => resolve(rect())));
    const first = rect();
    return (await frame()) === first && (await frame()) === first;
  }, VIEW_TYPE);
}

export function cardIds(): Promise<string[]> {
  return browser.execute(
    (type) =>
      [...document.querySelectorAll<HTMLElement>(`.workspace-leaf-content[data-type="${type}"] .agents-inbox-card[data-id]`)].map(
        (el) => el.dataset.id ?? "",
      ),
    VIEW_TYPE,
  );
}

export function groupTitles(): Promise<string[]> {
  return browser.execute(
    (type) =>
      [...document.querySelectorAll<HTMLElement>(`.workspace-leaf-content[data-type="${type}"] .agents-inbox-group-title`)].map(
        (el) => el.textContent ?? "",
      ),
    VIEW_TYPE,
  );
}

export function cardGroups(): Promise<{ id: string; group: string }[]> {
  return browser.execute(
    (type) =>
      [...document.querySelectorAll<HTMLElement>(`.workspace-leaf-content[data-type="${type}"] .agents-inbox-card[data-id]`)].map(
        (el) => ({
          id: el.dataset.id ?? "",
          group: el.closest(".agents-inbox-group")?.querySelector(".agents-inbox-group-title")?.textContent ?? "",
        }),
      ),
    VIEW_TYPE,
  );
}

export function optionsOf(id: string): Promise<{ option: string; recommended: boolean }[]> {
  return browser.execute(
    (type, cardId) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          `.workspace-leaf-content[data-type="${type}"] .agents-inbox-card[data-id="${cardId}"] .agents-inbox-option`,
        ),
      ].map((el) => ({ option: el.dataset.option ?? "", recommended: el.classList.contains("is-recommended") })),
    VIEW_TYPE,
    id,
  );
}

export async function markWindow(): Promise<void> {
  await browser.execute(() => {
    document.body.dataset.agentsE2e = "kept";
  });
}

export function windowKept(): Promise<boolean> {
  return browser.execute(() => document.body.dataset.agentsE2e === "kept");
}

export async function markNote(id: string): Promise<void> {
  await browser.execute(
    (type, cardId) => {
      const note = document.querySelector<HTMLElement>(
        `.workspace-leaf-content[data-type="${type}"] .agents-inbox-card[data-id="${cardId}"] textarea.agents-inbox-note`,
      );
      if (note) note.dataset.agentsE2e = "kept";
    },
    VIEW_TYPE,
    id,
  );
}

export function noteState(id: string): Promise<{ kept: boolean; focused: boolean; value: string | null }> {
  return browser.execute(
    (type, cardId) => {
      const note = document.querySelector<HTMLTextAreaElement>(
        `.workspace-leaf-content[data-type="${type}"] .agents-inbox-card[data-id="${cardId}"] textarea.agents-inbox-note`,
      );
      return {
        kept: note?.dataset.agentsE2e === "kept",
        focused: note !== null && document.activeElement === note,
        value: note?.value ?? null,
      };
    },
    VIEW_TYPE,
    id,
  );
}
