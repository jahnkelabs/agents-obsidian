import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

const CLI = join(import.meta.dirname, "..", "dist", "inbox.js");

export interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inbox-"));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function tempDocs(...maps: string[]): string {
  const docs = tempDir();
  for (const map of maps) mkdirSync(join(docs, "maps", map), { recursive: true });
  return docs;
}

export function inbox(docs: string, args: string[], input = ""): Result {
  const { status, stdout, stderr } = spawnSync("node", [CLI, ...args], {
    env: { ...process.env, INBOX_DOCS_DIR: docs },
    input,
    encoding: "utf8",
  });
  return { status, stdout, stderr };
}

export function inboxAsync(docs: string, args: string[], input = ""): Promise<Result> & { exited: () => boolean } {
  const child = spawn("node", [CLI, ...args], { env: { ...process.env, INBOX_DOCS_DIR: docs } });
  child.stdin.end(input);
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

export function ask(docs: string, args: string[] = [], body = "**Deciding — Pick a library**\n\nfound: two\n"): string {
  const result = inbox(docs, ["ask", "--kind", "decide", "--from", "plan · s1", ...args], body);
  if (result.status !== 0) throw new Error(`ask failed: ${result.stderr}`);
  return result.stdout.trim();
}
