import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "../schema";
import { readItem } from "../store";

export interface Entry {
  id: string;
  path: string;
  item: Item;
}

export interface Broken {
  path: string;
  error: string;
}

const INBOX_PATH = /^(maps\/[^/]+\/)?inbox\/[^/]+\.md$/;

export function isInboxPath(vaultPath: string): boolean {
  return INBOX_PATH.test(vaultPath);
}

export function listAwaiting(docs: string): { entries: Entry[]; broken: Broken[] } {
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
  return { entries, broken };
}

export function lastAgentAt(item: Item): number | null {
  const last = item.thread.filter((message) => message.author === "agent").at(-1);
  return last === undefined ? null : Date.parse(last.at);
}

export function unread(entry: Entry, seen: number | undefined): boolean {
  const at = lastAgentAt(entry.item);
  return at !== null && (seen === undefined || at > seen);
}

export function title(item: Item): string {
  const line = item.body.split("\n").find((text) => text.trim() !== "") ?? "";
  return (
    line
      .replace(/^\s*#+\s*/, "")
      .replace(/\*\*|__|[*`]/g, "")
      .trim() || item.kind
  );
}

export function age(from: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(from)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / (24 * 60))}d`;
}

export function answerText(item: Item): string {
  return Array.isArray(item.answer) ? item.answer.join(", ") : (item.answer ?? "");
}

function inboxDirs(docs: string): string[] {
  const dirs = [join(docs, "inbox")];
  const maps = join(docs, "maps");
  if (existsSync(maps)) {
    for (const name of readdirSync(maps).sort()) dirs.push(join(maps, name, "inbox"));
  }
  return dirs.filter((dir) => existsSync(dir));
}

export function groupKey(g: { map: string | null; concern: string | null }): string {
  return `${g.map ?? ""}\u0000${g.concern ?? ""}`;
}
