import { Document, parseDocument } from "yaml";

export const KINDS = ["decide", "approve", "blocked", "review"] as const;
export const STATUSES = ["awaiting-you", "answered"] as const;
export const ANSWERERS = ["inbox", "chat"] as const;
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];
export type Answerer = (typeof ANSWERERS)[number];

export interface Item {
  type: "inbox";
  kind: Kind;
  map: string | null;
  concern: string | null;
  from: string;
  status: Status;
  options: string[];
  recommended: string | null;
  answer: string | null;
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
  "options",
  "recommended",
  "answer",
  "note",
  "answered_by",
  "created_at",
  "answered_at",
] as const;

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

  const item = { ...data, body: text.slice(end + CLOSING_FENCE.length) };
  validate(item);
  return item;
}

export function serialize(item: Item): string {
  validate(item);
  const ordered = Object.fromEntries(FIELDS.map((field) => [field, item[field]]));
  const frontmatter = new Document(ordered).toString({ lineWidth: 0 });
  return `${FENCE}${frontmatter}---\n${item.body}`;
}

export function validate(value: object): asserts value is Item {
  for (const key of Object.keys(value)) {
    if (key !== "body" && !(FIELDS as readonly string[]).includes(key)) {
      throw new SchemaError(key, "unknown field");
    }
  }
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

  const options = item.options as string[];
  const isOption = (v: unknown) => options.includes(v as string);
  check("recommended", item.recommended === null || isOption(item.recommended), "must be one of the options or null");
  check("answer", item.answer === null || typeof item.answer === "string", "must be a string or null");
  check("answer", item.answer === null || options.length === 0 || isOption(item.answer), "must be one of the options");
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

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function isSlug(value: unknown): boolean {
  return typeof value === "string" && SLUG.test(value);
}

function isTimestamp(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
