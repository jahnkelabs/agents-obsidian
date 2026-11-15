import { Document, parseDocument } from "yaml";

export const KINDS = ["decide", "approve", "blocked", "review"] as const;
export const STATUSES = ["awaiting-you", "answered"] as const;
export const ANSWERERS = ["inbox", "chat"] as const;
export const SELECTS = ["one", "many"] as const;
export const AUTHORS = ["you", "agent"] as const;
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type Answerer = (typeof ANSWERERS)[number];
export type Select = (typeof SELECTS)[number];
export type Author = (typeof AUTHORS)[number];

export interface Revision {
  select: Select;
  added: string[];
  removed: string[];
  recommended: string[];
}

export function shaped(select: Select, labels: string[]): string | string[] {
  return select === "one" && labels.length === 1 ? labels[0] : labels;
}

export function labelsOf(value: string | string[] | null): string[] {
  return [value ?? []].flat();
}

export interface Message {
  author: Author;
  at: string;
  text: string;
  revision?: Revision;
  delivered_at?: string;
}

export interface Item {
  type: "inbox";
  kind: Kind;
  map: string | null;
  concern: string | null;
  from: string;
  status: Status;
  select: Select;
  options: string[];
  recommended: string | string[] | null;
  thread: Message[];
  answer: string | string[] | null;
  note: string | null;
  answered_by: Answerer | null;
  created_at: string;
  answered_at: string | null;
  body: string;
}

const FIELDS = [
  "type",
  "kind",
  "map",
  "concern",
  "from",
  "status",
  "select",
  "options",
  "recommended",
  "thread",
  "answer",
  "note",
  "answered_by",
  "created_at",
  "answered_at",
] as const;

const SOURCE = Symbol("source");

type Sourced = Item & { [SOURCE]?: Document };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const FENCE = "---\n";
const CLOSING_FENCE = "\n---\n";

export class SchemaError extends Error {
  constructor(
    readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = "SchemaError";
  }
}

export function parse(text: string): Item {
  if (!text.startsWith(FENCE)) {
    throw new SchemaError("frontmatter", "the item must start with ---");
  }
  const end = text.indexOf(CLOSING_FENCE, FENCE.length - 1);
  if (end === -1) {
    throw new SchemaError("frontmatter", "no closing ---");
  }

  const doc = parseDocument(text.slice(FENCE.length, end + 1));
  if (doc.errors.length > 0) {
    throw new SchemaError("frontmatter", doc.errors[0].message);
  }
  const data: unknown = doc.toJS();
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SchemaError("frontmatter", "must be a mapping");
  }
  if ("body" in data) {
    throw new SchemaError("body", "unknown field");
  }

  const fields = Object.fromEntries(FIELDS.filter((field) => field in data).map((field) => [field, (data as Record<string, unknown>)[field]]));
  const item = { select: "one", thread: [], ...fields, body: text.slice(end + CLOSING_FENCE.length), [SOURCE]: doc };
  validate(item);
  return item;
}

export function serialize(item: Item): string {
  validate(item);
  const doc = (item as Sourced)[SOURCE]?.clone() ?? new Document({});
  const current = doc.toJS() as Record<string, unknown>;
  for (const field of FIELDS) {
    if (JSON.stringify(current[field]) !== JSON.stringify(item[field])) doc.set(field, doc.createNode(item[field]));
  }
  return `${FENCE}${doc.toString({ lineWidth: 0 })}---\n${item.body}`;
}

export function validate(value: object): asserts value is Item {
  for (const field of FIELDS) {
    if (!(field in value)) throw new SchemaError(field, "missing");
  }

  const item = value as Record<keyof Item, unknown>;
  check("type", item.type === "inbox", "must be inbox");
  check("kind", oneOf(item.kind, KINDS), `must be one of ${KINDS.join(", ")}`);
  check("map", item.map === null || isSlug(item.map), "must be a lowercase slug or null");
  check("concern", item.concern === null || isSlug(item.concern), "must be a lowercase slug or null");
  check("concern", item.concern === null || item.map !== null, "needs a map");
  check("from", typeof item.from === "string" && item.from.trim() !== "", "must be a non-empty string");
  check("status", oneOf(item.status, STATUSES), `must be one of ${STATUSES.join(", ")}`);
  check(
    "options",
    Array.isArray(item.options) && item.options.every((o) => typeof o === "string" && o !== ""),
    "must be a list of labels",
  );
  check("options", new Set(item.options as string[]).size === (item.options as string[]).length, "must not repeat a label");

  const options = item.options as string[];
  const isOption = (v: unknown) => options.includes(v as string);
  check("select", oneOf(item.select, SELECTS), `must be one of ${SELECTS.join(", ")}`);
  check("select", item.select === "one" || options.length > 0, "must be one on an open question");
  if (item.select === "many") {
    check("recommended", item.recommended === null || isLabelList(item.recommended, options), "must be a list of distinct options or null");
    check("answer", item.answer === null || Array.isArray(item.answer), "must be a list of options on a pick-many item");
    check("answer", item.answer === null || (item.answer as unknown[]).length > 0, "must not be an empty list");
    check("answer", item.answer === null || isLabelList(item.answer, options), "must be a list of distinct options");
  } else {
    check("recommended", !Array.isArray(item.recommended), "must be one label, not a list, on a pick-one item");
    check("recommended", item.recommended === null || isOption(item.recommended), "must be one of the options or null");
    check("answer", !Array.isArray(item.answer), "must be one label, not a list, on a pick-one item");
    check("answer", item.answer === null || typeof item.answer === "string", "must be a string or null");
    check("answer", item.answer === null || options.length === 0 || isOption(item.answer), "must be one of the options");
  }
  checkThread(item.thread);
  check("note", item.note === null || typeof item.note === "string", "must be a string or null");
  check("answered_by", item.answered_by === null || oneOf(item.answered_by, ANSWERERS), "must be inbox, chat, or null");
  check("created_at", isTimestamp(item.created_at), "must be an ISO 8601 timestamp");
  check("answered_at", item.answered_at === null || isTimestamp(item.answered_at), "must be an ISO 8601 timestamp or null");
  check("body", typeof item.body === "string" && item.body.trim() !== "", "must not be empty");

  const answered = item.status === "answered";
  for (const field of ["answer", "answered_by", "answered_at"] as const) {
    check(field, (item[field] !== null) === answered, answered ? "must be set on an answered item" : "must be null until answered");
  }
  check("note", answered || item.note === null, "must be null until answered");
}

function check(field: string, ok: boolean, detail: string): void {
  if (!ok) throw new SchemaError(field, detail);
}

function checkThread(thread: unknown): void {
  check("thread", Array.isArray(thread), "must be a list of messages");
  let previous = -Infinity;
  (thread as unknown[]).forEach((message, index) => {
    const which = `message ${index + 1}`;
    check("thread", typeof message === "object" && message !== null && !Array.isArray(message), `${which} must be a mapping`);
    const { author, at: time, text, revision, delivered_at } = message as Record<string, unknown>;
    check("thread", oneOf(author, AUTHORS), `${which} author must be one of ${AUTHORS.join(", ")}`);
    check("thread", isTimestamp(time), `${which} at must be an ISO 8601 timestamp`);
    check("thread", typeof text === "string", `${which} text must be a string`);
    if (revision === undefined) {
      check("thread", (text as string).trim() !== "", `${which} text must not be empty`);
    } else {
      check("thread", author === "agent", `${which} revision must come from the agent`);
      checkRevision(revision, which);
    }
    if (delivered_at !== undefined) {
      check("thread", author === "you", `${which} delivered_at belongs only on your message`);
      check("thread", isTimestamp(delivered_at), `${which} delivered_at must be an ISO 8601 timestamp`);
    }
    const current = Date.parse(time as string);
    check("thread", current >= previous, `${which} at must not precede the message before it`);
    previous = current;
  });
}

function checkRevision(revision: unknown, which: string): void {
  check("thread", typeof revision === "object" && revision !== null && !Array.isArray(revision), `${which} revision must be a mapping`);
  const { select, added, removed, recommended } = revision as Record<string, unknown>;
  check("thread", oneOf(select, SELECTS), `${which} revision select must be one of ${SELECTS.join(", ")}`);
  for (const [name, list] of Object.entries({ added, removed, recommended })) {
    check("thread", Array.isArray(list) && list.every((label) => typeof label === "string"), `${which} revision ${name} must be a list of labels`);
  }
}

function isLabelList(value: unknown, options: string[]): boolean {
  return Array.isArray(value) && value.every((v) => options.includes(v)) && new Set(value).size === value.length;
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function isSlug(value: unknown): boolean {
  return typeof value === "string" && SLUG.test(value);
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "string" && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}
