export type DocKind = "map" | "requirements" | "design" | "implementation";

export interface ContextDoc {
  kind: DocKind;
  label: "Map" | "Requirements" | "Design" | "Implementation";
  vaultPath: string;
}

export interface Citation {
  vaultPath: string;
  subpath: string | null;
  row: number | null;
}

const CONCERN_DOCS: { kind: Exclude<DocKind, "map">; label: ContextDoc["label"] }[] = [
  { kind: "requirements", label: "Requirements" },
  { kind: "design", label: "Design" },
  { kind: "implementation", label: "Implementation" },
];

const STEPS = [null, "sliced", "built", "critiqued", "committed", "pr-open", "landed"];

const ROW_DISPLAY = /^(?:criterion|row)\s+(\d+)$/i;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const SEPARATOR = /^\s*\|?(\s*:?-+:?\s*\|)*\s*:?-+:?\s*\|?\s*$/;

interface Line {
  text: string;
  code: boolean;
}

export function contextDocs(map: string, concern: string | null, exists: (vaultPath: string) => boolean): ContextDoc[] {
  const docs: ContextDoc[] = [{ kind: "map", label: "Map", vaultPath: `maps/${map}/map.md` }];
  if (concern !== null) {
    for (const { kind, label } of CONCERN_DOCS) docs.push({ kind, label, vaultPath: `maps/${map}/${concern}/${kind}.md` });
  }
  return docs.filter((doc) => exists(doc.vaultPath));
}

export function parseCitation(linktext: string, display: string | null, resolve: (linkpath: string) => string | null): Citation | null {
  const hash = linktext.indexOf("#");
  const linkpath = hash === -1 ? linktext : linktext.slice(0, hash);
  const subpath = hash === -1 || hash === linktext.length - 1 ? null : linktext.slice(hash + 1);
  const vaultPath = resolve(linkpath);
  if (vaultPath === null) return null;
  const shown = display === null ? null : ROW_DISPLAY.exec(display.trim());
  return { vaultPath, subpath, row: shown === null ? null : Number(shown[1]) };
}

export function citedRow(markdown: string, subpath: string | null, row: number | null): number | null {
  if (subpath === null || row === null || !Number.isInteger(row) || row < 1) return null;
  const lines = scan(markdown);
  const target = subpath.trim().toLowerCase();
  const start = lines.findIndex((line) => {
    const found = headingOf(line);
    return found !== null && found.text.toLowerCase() === target;
  });
  if (start === -1) return null;
  const level = headingOf(lines[start])?.level ?? 0;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const found = headingOf(lines[i]);
    if (found !== null && found.level <= level) {
      end = i;
      break;
    }
  }
  for (let i = start + 1; i < end - 1; i++) {
    if (!isTableLine(lines[i]) || lines[i + 1].code || !SEPARATOR.test(lines[i + 1].text) || !lines[i + 1].text.includes("|")) continue;
    let rows = 0;
    for (let j = i + 2; j < end && isTableLine(lines[j]); j++) rows++;
    return row <= rows ? row : null;
  }
  return null;
}

export function designOutline(markdown: string): string[] {
  return scan(markdown).flatMap((line) => {
    const found = headingOf(line);
    return found !== null && found.level === 2 ? [found.text] : [];
  });
}

export function stepIndex(step: string | null): number {
  return STEPS.indexOf(step);
}

function isTableLine(line: Line): boolean {
  return !line.code && line.text.includes("|");
}

function headingOf(line: Line): { level: number; text: string } | null {
  if (line.code) return null;
  const found = HEADING.exec(line.text);
  return found === null ? null : { level: found[1].length, text: found[2].trim() };
}

function scan(markdown: string): Line[] {
  const texts = markdown.split(/\r?\n/);
  const lines: Line[] = texts.map((text) => ({ text, code: false }));
  let from = 0;
  if (texts[0]?.trimEnd() === "---") {
    const close = texts.findIndex((text, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(text));
    if (close !== -1) {
      for (let i = 0; i <= close; i++) lines[i].code = true;
      from = close + 1;
    }
  }
  let fence: { char: string; length: number } | null = null;
  for (let i = from; i < lines.length; i++) {
    const text = lines[i].text;
    if (fence === null) {
      const open = FENCE_OPEN.exec(text);
      if (open !== null) {
        fence = { char: open[1][0], length: open[1].length };
        lines[i].code = true;
      }
      continue;
    }
    lines[i].code = true;
    const close = FENCE_CLOSE.exec(text);
    if (close !== null && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
  }
  return lines;
}
