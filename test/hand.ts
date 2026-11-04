import { expect } from "vitest";
import { parseDocument } from "yaml";

export const HAND = `---
type: inbox
tags: [urgent, inbox]   # added in Obsidian
kind: decide
from: 'plan · s1'
map: null
concern: ~
status: awaiting-you

# the choices
options: [ship, hold]
recommended: "ship"
answer: null
note: null
answered_by: null
created_at: 2026-11-03T05:30:00Z
answered_at: null
aliases:
  - pick
---
**Deciding — Ship or hold**
`;

export function frontmatter(text: string): Record<string, unknown> {
  return parseDocument(text.slice(4, text.indexOf("\n---\n") + 1)).toJS();
}

function keys(text: string): string[] {
  return [...text.slice(0, text.indexOf("\n---\n")).matchAll(/^([a-z_]+):/gm)].map((match) => match[1]);
}

export function expectHandStyleKept(after: string): void {
  expect(keys(after)).toEqual(keys(HAND));
  expect(after).toContain("# added in Obsidian");
  expect(after).toContain("# the choices");
  expect(after).toContain("from: 'plan · s1'");
  expect(after).toContain('recommended: "ship"');
  expect(after).toContain("concern: ~");
  expect(after).toMatch(/^tags: \[ ?urgent, inbox ?\]/m);
  expect(after).toMatch(/^options: \[ ?ship, hold ?\]$/m);
}
