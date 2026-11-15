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

export const STEPS = [null, "sliced", "built", "critiqued", "committed", "pr-open", "landed"];

const ROW_DISPLAY = /^(?:criterion|row)\s+(\d+)$/i;

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
  const subpath = hash === -1 ? null : linktext.slice(hash + 1) || null;
  const vaultPath = resolve(linkpath);
  if (vaultPath === null) return null;
  const shown = display === null ? null : ROW_DISPLAY.exec(display.trim());
  return { vaultPath, subpath, row: shown === null ? null : Number(shown[1]) };
}

export function stepIndex(step: string | null): number {
  return STEPS.indexOf(step);
}
