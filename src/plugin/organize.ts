import { type Kind, KINDS } from "../schema";
import { type Entry, groupKey, title } from "./inbox";

export type GroupBy = "concern" | "map" | "kind" | "age" | "none";
export type Sort = "newest" | "oldest" | "activity";
export type StateFilter = "new-reply" | "waiting-on-agent";
export type AgeBucket = "Today" | "This week" | "Older";

export interface Filters {
  state: Set<StateFilter>;
  kind: Set<Kind>;
  map: Set<string | null>;
}

export interface View {
  query: string;
  filters: Filters;
  groupBy: GroupBy;
  sort: Sort;
}

export interface Match {
  entry: Entry;
  unread: boolean;
  snippet: { before: string; hit: string; after: string } | null;
}

export interface Shown {
  groups: { key: string; title: string | null; entries: Match[] }[];
  shown: number;
  waiting: number;
  counts: { state: Map<StateFilter, number>; kind: Map<Kind, number>; map: Map<string | null, number> };
}

const STATES: StateFilter[] = ["new-reply", "waiting-on-agent"];
const AGES: AgeBucket[] = ["Today", "This week", "Older"];
const SNIPPET_SPAN = 40;
const DAY = 24 * 60 * 60_000;
const WEEK = 7 * DAY;

export function organize(entries: Entry[], view: View, unread: (entry: Entry) => boolean, now: number): Shown {
  const query = view.query.trim().toLowerCase();
  const searched = entries.flatMap((entry) => {
    const snippet = search(entry, query);
    return snippet === undefined ? [] : [{ entry, unread: unread(entry), snippet }];
  });
  const counts = countChoices(entries, searched);
  const matches = searched.filter((match) => passes(match, view.filters));
  const groups = group(matches, view.groupBy, now).map((g) => ({ ...g, entries: g.entries.sort(compareBy(view.sort)) }));
  return { groups, shown: matches.length, waiting: entries.length, counts };
}

export function stateOf(entry: Entry, unread: boolean): StateFilter[] {
  const states: StateFilter[] = [];
  if (unread) states.push("new-reply");
  if (entry.item.thread.at(-1)?.author === "you") states.push("waiting-on-agent");
  return states;
}

export function locationOf(map: string | null, concern: string | null): string {
  if (map === null) return "No map";
  return concern === null ? map : `${map} / ${concern}`;
}

export function ageBucket(createdAt: string, now: number): AgeBucket {
  const elapsed = now - Date.parse(createdAt);
  if (elapsed < DAY) return "Today";
  return elapsed < WEEK ? "This week" : "Older";
}

function search(entry: Entry, query: string): Match["snippet"] | undefined {
  if (query === "") return null;
  const { item } = entry;
  if (title(item).toLowerCase().includes(query)) return null;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
  for (const text of [item.body, ...item.thread.map((message) => message.text)]) {
    const found = pattern.exec(text);
    if (found !== null) {
      const at = found.index;
      const end = at + found[0].length;
      return {
        before: text.slice(Math.max(0, at - SNIPPET_SPAN), at),
        hit: text.slice(at, end),
        after: text.slice(end, end + SNIPPET_SPAN),
      };
    }
  }
  return undefined;
}

function passes(match: Match, filters: Filters): boolean {
  const { item } = match.entry;
  return (
    (filters.state.size === 0 || stateOf(match.entry, match.unread).some((state) => filters.state.has(state))) &&
    (filters.kind.size === 0 || filters.kind.has(item.kind)) &&
    (filters.map.size === 0 || filters.map.has(item.map))
  );
}

function countChoices(entries: Entry[], searched: Match[]): Shown["counts"] {
  const maps = [...new Set([...entries.map((entry) => entry.item.map), null])].sort(compareMaps);
  const counts: Shown["counts"] = {
    state: new Map<StateFilter, number>(STATES.map((state) => [state, 0])),
    kind: new Map<Kind, number>(KINDS.map((kind) => [kind, 0])),
    map: new Map<string | null, number>(maps.map((map) => [map, 0])),
  };
  for (const match of searched) {
    const { kind, map } = match.entry.item;
    for (const state of stateOf(match.entry, match.unread)) counts.state.set(state, (counts.state.get(state) ?? 0) + 1);
    counts.kind.set(kind, (counts.kind.get(kind) ?? 0) + 1);
    counts.map.set(map, (counts.map.get(map) ?? 0) + 1);
  }
  return counts;
}

interface Label {
  key: string;
  title: string | null;
  rank: number;
  name: string;
  sub: string;
}

function label(entry: Entry, groupBy: GroupBy, now: number): Label {
  const { map, concern, kind, created_at } = entry.item;
  const rank = map === null ? 1 : 0;
  switch (groupBy) {
    case "concern":
      return { key: groupKey(entry.item), title: locationOf(map, concern), rank, name: map ?? "", sub: concern ?? "" };
    case "map":
      return { key: `map:${map ?? ""}`, title: map ?? "No map", rank, name: map ?? "", sub: "" };
    case "kind":
      return { key: `kind:${kind}`, title: kind, rank: KINDS.indexOf(kind), name: "", sub: "" };
    case "age": {
      const bucket = ageBucket(created_at, now);
      return { key: `age:${bucket}`, title: bucket, rank: AGES.indexOf(bucket), name: "", sub: "" };
    }
    case "none":
      return { key: "none", title: null, rank: 0, name: "", sub: "" };
  }
}

function group(matches: Match[], groupBy: GroupBy, now: number): Shown["groups"] {
  const byKey = new Map<string, { label: Label; entries: Match[] }>();
  for (const match of matches) {
    const next = label(match.entry, groupBy, now);
    const found = byKey.get(next.key);
    if (found) found.entries.push(match);
    else byKey.set(next.key, { label: next, entries: [match] });
  }
  return [...byKey.values()]
    .sort((a, b) => a.label.rank - b.label.rank || a.label.name.localeCompare(b.label.name) || a.label.sub.localeCompare(b.label.sub))
    .map(({ label: { key, title: heading }, entries }) => ({ key, title: heading, entries }));
}

export function compareMaps(a: string | null, b: string | null): number {
  if ((a === null) !== (b === null)) return a === null ? 1 : -1;
  return (a ?? "").localeCompare(b ?? "");
}

function compareBy(sort: Sort): (a: Match, b: Match) => number {
  const time = (match: Match): number => (sort === "activity" ? activityAt(match.entry) : Date.parse(match.entry.item.created_at));
  const direction = sort === "oldest" ? 1 : -1;
  return (a, b) => direction * (time(a) - time(b)) || a.entry.path.localeCompare(b.entry.path);
}

function activityAt(entry: Entry): number {
  const times = entry.item.thread.map((message) => Date.parse(message.at));
  return times.length === 0 ? Date.parse(entry.item.created_at) : Math.max(...times);
}
