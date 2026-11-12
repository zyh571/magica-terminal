// A tab's panes as a tree of splits ("h": side by side, "v": stacked; ratio = the first side's share).
export type Orient = "h" | "v";
export type Node = { kind: "pane"; id: number } | { kind: "split"; orient: Orient; ratio: number; a: Node; b: Node };
export type LayoutSpec = string | [Orient, LayoutSpec[]];

/** `pair` (Madoka | Homura) and `magica` (Madoka, Homura above; Sayaka, Mami, Kyoko below). */
export const LAYOUTS: Record<"pair" | "magica", LayoutSpec> = {
  pair: ["h", ["madoka", "homura"]],
  magica: ["v", [["h", ["madoka", "homura"]], ["h", ["sayaka", "mami", "kyoko"]]]],
};

export function paneIds(n: Node): number[] {
  return n.kind === "pane" ? [n.id] : [...paneIds(n.a), ...paneIds(n.b)];
}

/** Split pane `id` in two: it stays first, `newId` comes second, half each. */
export function split(n: Node, id: number, orient: Orient, newId: number): Node {
  if (n.kind === "pane") return n.id === id ? { kind: "split", orient, ratio: 0.5, a: n, b: { kind: "pane", id: newId } } : n;
  return { ...n, a: split(n.a, id, orient, newId), b: split(n.b, id, orient, newId) };
}

/** Take pane `id` out; its sibling takes the split's place. null when it was the only pane. */
export function remove(n: Node, id: number): Node | null {
  if (n.kind === "pane") return n.id === id ? null : n;
  const a = remove(n.a, id), b = remove(n.b, id);
  if (!a) return b;
  if (!b) return a;
  return { ...n, a, b };
}

/** Build a layout: each name becomes a pane through `leaf`, each list equal splits (3 → 1/3, then 1/2). */
export function build(spec: LayoutSpec, leaf: (name: string) => Node): Node {
  if (typeof spec === "string") return leaf(spec);
  const [orient, items] = spec;
  const nodes = items.map((i) => build(i, leaf));
  const equal = (ns: Node[]): Node =>
    ns.length === 1 ? ns[0] : { kind: "split", orient, ratio: 1 / ns.length, a: ns[0], b: equal(ns.slice(1)) };
  return equal(nodes);
}

/** The pane to move to from `from` in direction (dx, dy): the nearest ahead, panes in line counting nearer than
 * ones off to the side. */
export function neighbour(centres: Map<number, { x: number; y: number }>, from: number, dx: number, dy: number): number | null {
  const cur = centres.get(from);
  if (!cur) return null;
  let best: number | null = null, bestD = Infinity;
  for (const [id, p] of centres) {
    if (id === from) continue;
    const ddx = p.x - cur.x, ddy = p.y - cur.y;
    const along = ddx * dx + ddy * dy;
    if (along <= 0) continue;
    const d = along + 2 * Math.abs(ddx * dy + ddy * dx);
    if (d < bestD) {
      best = id;
      bestD = d;
    }
  }
  return best;
}
