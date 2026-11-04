import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { $, browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { type Answerer, type Item, parse, serialize } from "../../src/schema";

export const VIEW_TYPE = "agents-inbox";

export const ROOT_QUESTION = "inbox/root-question.md";
export const M1_OLDER = "maps/m1/inbox/m1-older.md";
export const M1_NEWER = "maps/m1/inbox/m1-newer.md";
export const M1_ANSWERED = "maps/m1/inbox/m1-answered.md";
export const M2_OPEN_QUESTION = "maps/m2/inbox/m2-open-question.md";
export const FIXTURES = [ROOT_QUESTION, M1_OLDER, M1_NEWER, M1_ANSWERED, M2_OPEN_QUESTION];

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

export function answerUnderLock(rel: string, answer: string, answered_by: Answerer): void {
  const path = join(vault(), rel);
  const item = parse(readFileSync(path, "utf8"));
  const text = serialize({ ...item, answer, note: null, answered_by, status: "answered", answered_at: new Date().toISOString() });
  const tmp = join(dirname(path), `.e2e-${process.pid}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
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
