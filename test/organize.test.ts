import { describe, expect, it } from "vitest";
import type { Item, Kind, Message } from "../src/schema";
import type { Entry } from "../src/plugin/inbox";
import { ageBucket, type Filters, type GroupBy, organize, type Sort, stateOf, type View } from "../src/plugin/organize";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function message(author: Message["author"], msAgo: number, text = "ok"): Message {
  return { author, at: iso(msAgo), text };
}

function entry(id: string, over: Partial<Item> = {}): Entry {
  const item: Item = {
    type: "inbox",
    kind: "decide",
    map: null,
    concern: null,
    from: "plan · s1",
    status: "awaiting-you",
    select: "one",
    options: [],
    recommended: null,
    thread: [],
    answer: null,
    note: null,
    answered_by: null,
    created_at: iso(HOUR),
    answered_at: null,
    body: `**Deciding — ${id}**\n`,
    ...over,
  };
  return { id, path: `/vault/inbox/${id}.md`, item };
}

const ENTRIES: Entry[] = [
  entry("a1", { kind: "decide", map: "alpha", concern: "c1", created_at: iso(2 * HOUR) }),
  entry("a2", { kind: "approve", map: "alpha", concern: "c1", created_at: iso(5 * HOUR) }),
  entry("a3", { kind: "blocked", map: "alpha", concern: "c2", created_at: iso(3 * DAY), thread: [message("agent", 2 * DAY), message("you", 1 * DAY)] }),
  entry("a4", { kind: "review", map: "alpha", concern: null, created_at: iso(10 * DAY) }),
  entry("b1", { kind: "decide", map: "beta", concern: "c1", created_at: iso(6 * DAY), thread: [message("agent", 4 * HOUR)] }),
  entry("n1", { kind: "approve", map: null, created_at: iso(30 * HOUR) }),
  entry("n2", { kind: "review", map: null, created_at: iso(20 * DAY) }),
];

const NEVER = (): boolean => false;

function filters(over: Partial<Filters> = {}): Filters {
  return { state: new Set(), kind: new Set(), map: new Set(), ...over };
}

function view(over: Partial<View> = {}): View {
  return { query: "", filters: filters(), groupBy: "concern", sort: "newest", ...over };
}

function ids(shown: ReturnType<typeof organize>): string[][] {
  return shown.groups.map((g) => g.entries.map((m) => m.entry.id));
}

function flat(shown: ReturnType<typeof organize>): string[] {
  return ids(shown).flat();
}

describe("grouping and order", () => {
  it("concern: maps by name, concerns by name, a map with no concern first in its map, No map last", () => {
    const shown = organize(ENTRIES, view({ groupBy: "concern" }), NEVER, NOW);
    expect(shown.groups.map((g) => g.title)).toEqual(["alpha", "alpha / c1", "alpha / c2", "beta / c1", "No map"]);
    expect(ids(shown)).toEqual([["a4"], ["a1", "a2"], ["a3"], ["b1"], ["n1", "n2"]]);
  });

  it("map: maps by name, No map last", () => {
    const shown = organize(ENTRIES, view({ groupBy: "map" }), NEVER, NOW);
    expect(shown.groups.map((g) => g.title)).toEqual(["alpha", "beta", "No map"]);
    expect(ids(shown)).toEqual([["a1", "a2", "a3", "a4"], ["b1"], ["n1", "n2"]]);
  });

  it("kind: decide, approve, blocked, review", () => {
    const shown = organize(ENTRIES, view({ groupBy: "kind" }), NEVER, NOW);
    expect(shown.groups.map((g) => g.title)).toEqual(["decide", "approve", "blocked", "review"]);
    expect(ids(shown)).toEqual([["a1", "b1"], ["a2", "n1"], ["a3"], ["a4", "n2"]]);
  });

  it("age: Today, This week, Older", () => {
    const shown = organize(ENTRIES, view({ groupBy: "age" }), NEVER, NOW);
    expect(shown.groups.map((g) => g.title)).toEqual(["Today", "This week", "Older"]);
    expect(ids(shown)).toEqual([["a1", "a2"], ["n1", "a3", "b1"], ["a4", "n2"]]);
  });

  it("none: one group with a null title", () => {
    const shown = organize(ENTRIES, view({ groupBy: "none" }), NEVER, NOW);
    expect(shown.groups).toHaveLength(1);
    expect(shown.groups[0].title).toBeNull();
    expect(flat(shown)).toEqual(["a1", "a2", "n1", "a3", "b1", "a4", "n2"]);
  });

  it("omits a group with no entries, and returns no group when nothing matches", () => {
    const only = organize([ENTRIES[0]], view({ groupBy: "kind" }), NEVER, NOW);
    expect(only.groups.map((g) => g.title)).toEqual(["decide"]);
    expect(organize([], view({ groupBy: "none" }), NEVER, NOW).groups).toEqual([]);
  });

  it("gives the same group the same key on every call", () => {
    const modes: GroupBy[] = ["concern", "map", "kind", "age", "none"];
    for (const groupBy of modes) {
      const first = organize(ENTRIES, view({ groupBy }), NEVER, NOW);
      const later = organize([...ENTRIES].reverse(), view({ groupBy, sort: "oldest" }), NEVER, NOW + 60_000);
      expect(later.groups.map((g) => g.key).sort()).toEqual(first.groups.map((g) => g.key).sort());
      expect(new Set(first.groups.map((g) => g.key)).size).toBe(first.groups.length);
    }
  });
});

describe("every item exactly once", () => {
  const modes: GroupBy[] = ["concern", "map", "kind", "age", "none"];
  const sorts: Sort[] = ["newest", "oldest", "activity"];
  for (const groupBy of modes) {
    for (const sort of sorts) {
      it(`${groupBy} grouping, ${sort} sort`, () => {
        const shown = organize(ENTRIES, view({ groupBy, sort }), NEVER, NOW);
        expect(flat(shown).sort()).toEqual(ENTRIES.map((e) => e.id).sort());
        expect(shown.shown).toBe(ENTRIES.length);
        expect(shown.waiting).toBe(ENTRIES.length);
      });
    }
  }
});

describe("sort", () => {
  const one = (sort: Sort) => flat(organize(ENTRIES, view({ groupBy: "none", sort }), NEVER, NOW));

  it("newest orders by created_at, newest first", () => {
    expect(one("newest")).toEqual(["a1", "a2", "n1", "a3", "b1", "a4", "n2"]);
  });

  it("oldest orders by created_at, oldest first", () => {
    expect(one("oldest")).toEqual(["n2", "a4", "b1", "a3", "n1", "a2", "a1"]);
  });

  it("activity orders by the newest thread entry, else created_at", () => {
    expect(one("activity")).toEqual(["a1", "b1", "a2", "a3", "n1", "a4", "n2"]);
  });

  it("sorts inside each group", () => {
    const shown = organize(ENTRIES, view({ groupBy: "map", sort: "oldest" }), NEVER, NOW);
    expect(ids(shown)).toEqual([["a4", "a3", "a2", "a1"], ["b1"], ["n2", "n1"]]);
  });
});

describe("search", () => {
  const long = (n: number, ch: string) => ch.repeat(n);

  it("matches a title ignoring case, with no snippet", () => {
    const shown = organize(ENTRIES, view({ query: "A1", groupBy: "none" }), NEVER, NOW);
    expect(flat(shown)).toEqual(["a1"]);
    expect(shown.groups[0].entries[0].snippet).toBeNull();
  });

  it("matches a body below the title, with about 40 characters each side", () => {
    const body = `**Deciding — plain**\n\n${long(60, "x")}NeedLE${long(60, "y")}\n`;
    const shown = organize([entry("body", { body }), ENTRIES[0]], view({ query: "needle" }), NEVER, NOW);
    expect(flat(shown)).toEqual(["body"]);
    expect(shown.groups[0].entries[0].snippet).toEqual({ before: long(40, "x"), hit: "NeedLE", after: long(40, "y") });
  });

  it("keeps a short snippet whole at the edges of the text", () => {
    const shown = organize([entry("edge", { body: "# t\n\nfind me" })], view({ query: "find" }), NEVER, NOW);
    const snippet = shown.groups[0].entries[0].snippet;
    expect(snippet?.hit).toBe("find");
    expect(snippet?.after).toBe(" me");
    expect(snippet?.before.endsWith("\n\n")).toBe(true);
  });

  it("matches thread text when title and body do not", () => {
    const thread = [message("agent", HOUR, "first"), message("you", HOUR / 2, "the Gateway drops it")];
    const shown = organize([entry("t", { thread }), ENTRIES[0]], view({ query: "gateway" }), NEVER, NOW);
    expect(flat(shown)).toEqual(["t"]);
    expect(shown.groups[0].entries[0].snippet).toEqual({ before: "the ", hit: "Gateway", after: " drops it" });
  });

  it("prefers the title over the body over the thread", () => {
    const item = entry("order", { body: "# needle title\n\nneedle body", thread: [message("agent", HOUR, "needle thread")] });
    expect(organize([item], view({ query: "needle" }), NEVER, NOW).groups[0].entries[0].snippet).toBeNull();
    const body = entry("order", { body: "# plain\n\nneedle body", thread: [message("agent", HOUR, "needle thread")] });
    expect(organize([body], view({ query: "needle" }), NEVER, NOW).groups[0].entries[0].snippet?.after).toBe(" body");
  });

  it("returns no match, with the waiting total intact, when nothing contains the query", () => {
    const shown = organize(ENTRIES, view({ query: "zzzz-nothing" }), NEVER, NOW);
    expect(shown.groups).toEqual([]);
    expect(shown.shown).toBe(0);
    expect(shown.waiting).toBe(ENTRIES.length);
  });

  it("treats a blank query as no search", () => {
    expect(organize(ENTRIES, view({ query: "   " }), NEVER, NOW).shown).toBe(ENTRIES.length);
  });
});

describe("filters", () => {
  const readsAgent = (e: Entry): boolean => e.id === "b1";

  it("an empty section passes every item", () => {
    expect(organize(ENTRIES, view({ filters: filters() }), NEVER, NOW).shown).toBe(ENTRIES.length);
  });

  it("choices inside one section combine with or", () => {
    const shown = organize(ENTRIES, view({ filters: filters({ kind: new Set<Kind>(["decide", "blocked"]) }), groupBy: "none" }), NEVER, NOW);
    expect(flat(shown).sort()).toEqual(["a1", "a3", "b1"]);
  });

  it("sections combine with and", () => {
    const shown = organize(
      ENTRIES,
      view({ filters: filters({ kind: new Set<Kind>(["decide", "approve"]), map: new Set(["alpha"]) }), groupBy: "none" }),
      NEVER,
      NOW,
    );
    expect(flat(shown).sort()).toEqual(["a1", "a2"]);
  });

  it("the map section matches No map through null", () => {
    const shown = organize(ENTRIES, view({ filters: filters({ map: new Set([null]) }), groupBy: "none" }), NEVER, NOW);
    expect(flat(shown).sort()).toEqual(["n1", "n2"]);
  });

  it("the state section filters on new-reply and waiting-on-agent", () => {
    const newReply = organize(ENTRIES, view({ filters: filters({ state: new Set(["new-reply"]) }), groupBy: "none" }), readsAgent, NOW);
    expect(flat(newReply)).toEqual(["b1"]);
    const waiting = organize(ENTRIES, view({ filters: filters({ state: new Set(["waiting-on-agent"]) }), groupBy: "none" }), readsAgent, NOW);
    expect(flat(waiting)).toEqual(["a3"]);
    const either = organize(
      ENTRIES,
      view({ filters: filters({ state: new Set(["new-reply", "waiting-on-agent"]) }), groupBy: "none" }),
      readsAgent,
      NOW,
    );
    expect(flat(either).sort()).toEqual(["a3", "b1"]);
  });

  it("filters combine with the search", () => {
    const shown = organize(ENTRIES, view({ query: "a", filters: filters({ kind: new Set<Kind>(["review"]) }), groupBy: "none" }), NEVER, NOW);
    expect(flat(shown)).toEqual(["a4"]);
  });

  it("reports each match's unread flag from the callback", () => {
    const shown = organize(ENTRIES, view({ groupBy: "none" }), readsAgent, NOW);
    const flags = Object.fromEntries(shown.groups[0].entries.map((m) => [m.entry.id, m.unread]));
    expect(flags).toMatchObject({ b1: true, a1: false });
  });
});

describe("counts", () => {
  const readsAgent = (e: Entry): boolean => e.id === "b1";

  it("count every choice over all items when no search is active", () => {
    const { counts } = organize(ENTRIES, view(), readsAgent, NOW);
    expect(Object.fromEntries(counts.state)).toEqual({ "new-reply": 1, "waiting-on-agent": 1 });
    expect(Object.fromEntries(counts.kind)).toEqual({ decide: 2, approve: 2, blocked: 1, review: 2 });
    expect(new Map(counts.map)).toEqual(new Map<string | null, number>([["alpha", 4], ["beta", 1], [null, 2]]));
  });

  it("count over the items the search passes", () => {
    const { counts } = organize(ENTRIES, view({ query: "a" }), readsAgent, NOW);
    expect(Object.fromEntries(counts.kind)).toEqual({ decide: 1, approve: 1, blocked: 1, review: 1 });
    expect(counts.map.get("alpha")).toBe(4);
    expect(counts.map.get("beta")).toBe(0);
    expect(counts.map.get(null)).toBe(0);
  });

  it("do not change when filters change", () => {
    const open = organize(ENTRIES, view(), readsAgent, NOW).counts;
    const narrowed = organize(
      ENTRIES,
      view({ filters: filters({ kind: new Set<Kind>(["review"]), map: new Set(["beta"]), state: new Set(["new-reply"]) }) }),
      readsAgent,
      NOW,
    );
    expect(narrowed.shown).toBe(0);
    expect(narrowed.counts).toEqual(open);
  });

  it("order the map choices by name with No map last", () => {
    const { counts } = organize([...ENTRIES].reverse(), view(), NEVER, NOW);
    expect([...counts.map.keys()]).toEqual(["alpha", "beta", null]);
  });
});

describe("stateOf", () => {
  it("reports new-reply for an unread agent entry", () => {
    expect(stateOf(entry("x", { thread: [message("agent", HOUR)] }), true)).toEqual(["new-reply"]);
  });

  it("reports waiting-on-agent when your message is the last thread entry", () => {
    expect(stateOf(entry("x", { thread: [message("agent", 2 * HOUR), message("you", HOUR)] }), false)).toEqual(["waiting-on-agent"]);
  });

  it("reports both when an unread agent entry precedes your last message", () => {
    expect(stateOf(entry("x", { thread: [message("agent", 2 * HOUR), message("you", HOUR)] }), true)).toEqual(["new-reply", "waiting-on-agent"]);
  });

  it("reports neither for a read agent entry, or an item with no thread", () => {
    expect(stateOf(entry("x", { thread: [message("agent", HOUR)] }), false)).toEqual([]);
    expect(stateOf(entry("x"), false)).toEqual([]);
  });
});

describe("ageBucket", () => {
  const at = (msAgo: number) => ageBucket(iso(msAgo), NOW);

  it("is Today under 24 hours old", () => {
    expect(at(0)).toBe("Today");
    expect(at(DAY - 1)).toBe("Today");
  });

  it("is This week from 24 hours up to 7 days", () => {
    expect(at(DAY)).toBe("This week");
    expect(at(7 * DAY - 1)).toBe("This week");
  });

  it("is Older from 7 days", () => {
    expect(at(7 * DAY)).toBe("Older");
    expect(at(90 * DAY)).toBe("Older");
  });

  it("is Today for a timestamp ahead of now", () => {
    expect(at(-HOUR)).toBe("Today");
  });
});
