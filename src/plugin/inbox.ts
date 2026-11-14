import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "../schema";
import { readItem } from "../store";

export interface Entry {
  id: string;
  path: string;
  item: Item;
}

export interface Group {
  map: string | null;
  concern: string | null;
  entries: Entry[];
}

export interface Broken {
  path: string;
  error: string;
}

const INBOX_PATH = /^(maps\/[^/]+\/)?inbox\/[^/]+\.md$/;

export function isInboxPath(vaultPath: string): boolean {
  return INBOX_PATH.test(vaultPath);
}

export function listAwaiting(docs: string): { groups: Group[]; broken: Broken[] } {
  const entries: Entry[] = [];
  const broken: Broken[] = [];
  for (const dir of inboxDirs(docs)) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || !name.endsWith(".md")) continue;
      const path = join(dir, name);
      try {
        const item = readItem(path);
        if (item.status === "awaiting-you") entries.push({ id: name.slice(0, -3), path, item });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        broken.push({ path, error: (error as Error).message });
      }
    }
  }
  return { groups: group(entries), broken };
}

export function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function inboxMtimes(docs: string): Map<string, number> {
  const mtimes = new Map<string, number>();
  for (const dir of inboxDirs(docs)) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || !name.endsWith(".md")) continue;
      const path = join(dir, name);
      const mtime = mtimeOf(path);
      if (mtime !== null) mtimes.set(path, mtime);
    }
  }
  return mtimes;
}

function inboxDirs(docs: string): string[] {
  const dirs = [join(docs, "inbox")];
  const maps = join(docs, "maps");
  if (existsSync(maps)) {
    for (const name of readdirSync(maps).sort()) dirs.push(join(maps, name, "inbox"));
  }
  return dirs.filter((dir) => existsSync(dir));
}

export function group(entries: Entry[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const entry of entries) {
    const { map, concern } = entry.item;
    const key = groupKey(entry.item);
    let found = byKey.get(key);
    if (!found) byKey.set(key, (found = { map, concern, entries: [] }));
    found.entries.push(entry);
  }
  const groups = [...byKey.values()];
  for (const g of groups) g.entries.sort((a, b) => Date.parse(b.item.created_at) - Date.parse(a.item.created_at));
  return groups.sort(compareGroups);
}

export function groupKey(g: { map: string | null; concern: string | null }): string {
  return `${g.map ?? ""}\u0000${g.concern ?? ""}`;
}

function compareGroups(a: Group, b: Group): number {
  if ((a.map === null) !== (b.map === null)) return a.map === null ? 1 : -1;
  return (a.map ?? "").localeCompare(b.map ?? "") || (a.concern ?? "").localeCompare(b.concern ?? "");
}
