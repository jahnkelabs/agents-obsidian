export const REFRESH_DELAY_MS = 16;

export function place(parent: HTMLElement, nodes: HTMLElement[]): void {
  const keep = new Set<Element>(nodes);
  for (const child of [...parent.children]) if (!keep.has(child)) child.remove();
  nodes.forEach((node, index) => {
    const at = parent.children.item(index);
    if (at !== node) parent.insertBefore(node, at);
  });
}
