import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Item, parse, serialize, SLUG } from "./schema";

export type Answer = Pick<Item, "answer" | "note" | "answered_by">;

const STALE_LOCK_MS = 30_000;
const LOCK_POLL_MS = 20;

export function docsDir(): string {
  return process.env.INBOX_DOCS_DIR ?? join(homedir(), "Code", "agent-docs");
}

export function findItem(docs: string, id: string): string | null {
  if (!SLUG.test(id)) return null;
  const candidates = [join(docs, "inbox", `${id}.md`)];
  const maps = join(docs, "maps");
  if (existsSync(maps)) {
    for (const entry of readdirSync(maps, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(join(maps, entry.name, "inbox", `${id}.md`));
    }
  }
  return candidates.find((path) => existsSync(path)) ?? null;
}

export function readItem(path: string): Item {
  return parse(readFileSync(path, "utf8"));
}

export function createItem(docs: string, item: Item): string {
  const text = serialize(item);
  if (item.map !== null && !existsSync(join(docs, "maps", item.map))) {
    throw new Error(`no map ${item.map} under ${join(docs, "maps")}`);
  }

  const dir = item.map === null ? join(docs, "inbox") : join(docs, "maps", item.map, "inbox");
  mkdirSync(dir, { recursive: true });

  const base = baseId(item);
  let id = base;
  for (let n = 2; findItem(docs, id) !== null; n++) id = `${base}-${n}`;

  writeAtomic(join(dir, `${id}.md`), text);
  return id;
}

export async function answerItem(path: string, answer: Answer): Promise<{ won: boolean; item: Item }> {
  const lock = `${path}.lock`;
  await acquireLock(lock);
  try {
    const item = readItem(path);
    if (item.status === "answered") return { won: false, item };

    const answered: Item = { ...item, ...answer, status: "answered", answered_at: new Date().toISOString() };
    writeAtomic(path, serialize(answered));
    return { won: true, item: answered };
  } finally {
    rmSync(lock, { force: true });
  }
}

export function answerOf(item: Item): Answer {
  return { answer: item.answer, note: item.note, answered_by: item.answered_by };
}

function baseId(item: Item): string {
  const stamp = `${item.created_at.slice(0, 10)}t${item.created_at.slice(11, 13)}${item.created_at.slice(14, 16)}`;
  const session = item.from.split(" · ").at(-1) ?? item.from;
  const topic = item.body.trim().split("\n")[0];
  const words = slugify(topic).split("-").slice(0, 5).join("-");
  return [stamp, item.map ?? slugify(session), words || item.kind].join("-");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function writeAtomic(path: string, text: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

async function acquireLock(lock: string): Promise<void> {
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, `${process.pid} ${Date.now()}\n`);
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (isStale(lock)) {
      rmSync(lock, { force: true });
    } else {
      await sleep(LOCK_POLL_MS);
    }
  }
}

function isStale(lock: string): boolean {
  let content: string;
  let modified: number;
  try {
    content = readFileSync(lock, "utf8");
    modified = statSync(lock).mtimeMs;
  } catch {
    return false;
  }

  const match = /^(\d+) (\d+)/.exec(content);
  if (!match) return Date.now() - modified > STALE_LOCK_MS;

  const [pid, takenAt] = [Number(match[1]), Number(match[2])];
  return Date.now() - takenAt > STALE_LOCK_MS || !isAlive(pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
