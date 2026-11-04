import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Answerer, type Item, parse, serialize, SLUG } from "./schema";

export interface Answer {
  answer: string;
  note: string | null;
  answered_by: Answerer;
}

const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = 2 * STALE_LOCK_MS;
const LOCK_POLL_MS = 20;
const ID_PART_CHARS = 60;

export function docsDir(): string {
  return process.env.INBOX_DOCS_DIR || join(homedir(), "Code", "agent-docs");
}

export function findItem(docs: string, id: string): string | null {
  if (!SLUG.test(id)) return null;
  const candidates = [join(docs, "inbox", `${id}.md`)];
  const maps = join(docs, "maps");
  if (existsSync(maps)) {
    for (const name of readdirSync(maps)) candidates.push(join(maps, name, "inbox", `${id}.md`));
  }
  const path = candidates.find((candidate) => existsSync(candidate)) ?? null;
  if (path !== null) assertInside(docs, dirname(path));
  return path;
}

export function readItem(path: string): Item {
  return parse(readFileSync(path, "utf8"));
}

export function createItem(docs: string, item: Item): string {
  const text = serialize(item);
  const parent = item.map === null ? docs : join(docs, "maps", item.map);
  if (item.map !== null) {
    if (!existsSync(parent)) throw new Error(`no map ${item.map} under ${join(docs, "maps")}`);
    assertInside(docs, parent);
  }

  const dir = join(parent, "inbox");
  mkdirSync(dir, { recursive: true });
  assertInside(docs, dir);

  const base = baseId(item);
  const tmp = writeTemp(dir, text);
  try {
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (findItem(docs, id) !== null) continue;
      try {
        linkSync(tmp, join(dir, `${id}.md`));
        return id;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
    }
  } finally {
    removeQuietly(tmp);
  }
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
    removeQuietly(lock);
  }
}

export function answerOf(item: Item) {
  return { answer: item.answer, note: item.note, answered_by: item.answered_by };
}

function assertInside(docs: string, path: string): void {
  const root = realpathSync(docs);
  const real = realpathSync(path);
  if (real !== root && !real.startsWith(root + sep)) throw new Error(`${path} resolves outside ${docs}`);
}

function baseId(item: Item): string {
  const stamp = item.created_at.slice(0, 16).toLowerCase().replace(":", "");
  const session = item.from.split(" · ").at(-1) ?? item.from;
  const topic = item.body.trim().split("\n")[0];
  const words = cap(slugify(topic).split("-").slice(0, 5).join("-"));
  return [stamp, cap(item.map ?? slugify(session)), words || item.kind].join("-");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cap(slug: string): string {
  return slug.slice(0, ID_PART_CHARS).replace(/-+$/, "");
}

function writeTemp(dir: string, text: string): string {
  const tmp = join(dir, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, text, { flag: "wx" });
  } catch (error) {
    removeQuietly(tmp);
    throw error;
  }
  return tmp;
}

function writeAtomic(path: string, text: string): void {
  const tmp = writeTemp(dirname(path), text);
  try {
    renameSync(tmp, path);
  } catch (error) {
    removeQuietly(tmp);
    throw error;
  }
}

async function acquireLock(lock: string): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    if (tryLock(lock)) return;
    const seen = readLock(lock);
    if (seen !== null && isStale(seen)) {
      steal(lock, seen);
      if (tryLock(lock)) return;
    }
    if (Date.now() > deadline) throw new Error(`timed out taking ${lock}`);
    await sleep(LOCK_POLL_MS);
  }
}

function tryLock(lock: string): boolean {
  const tmp = writeTemp(dirname(lock), `${process.pid} ${Date.now()}\n`);
  try {
    linkSync(tmp, lock);
    return true;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    return false;
  } finally {
    removeQuietly(tmp);
  }
}

function readLock(lock: string): string | null {
  try {
    return readFileSync(lock, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function steal(lock: string, seen: string): void {
  const moved = `${lock}.${process.pid}.stale`;
  try {
    renameSync(lock, moved);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
  // Rename, then compare: two processes can judge one lock stale, and a blind delete removes the lock the faster one just took.
  if (readFileSync(moved, "utf8") !== seen) {
    try {
      linkSync(moved, lock);
    } catch (error) {
      if (errorCode(error) === "EEXIST") return;
      throw error;
    }
  }
  removeQuietly(moved);
}

function isStale(content: string): boolean {
  const match = /^(\d+) (\d+)\n?$/.exec(content);
  if (!match) return true;
  const [pid, takenAt] = [Number(match[1]), Number(match[2])];
  return Date.now() - takenAt > STALE_LOCK_MS || !isAlive(pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {}
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}
