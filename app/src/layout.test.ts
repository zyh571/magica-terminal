import { describe, expect, test } from "vitest";
import { build, LAYOUTS, neighbour, Node, paneIds, remove, split } from "./layout";

const pane = (id: number): Node => ({ kind: "pane", id });
const ratios = (n: Node): number[] => (n.kind === "pane" ? [] : [n.ratio, ...ratios(n.a), ...ratios(n.b)]);

describe("split tree", () => {
  test("split then remove gives the original", () => {
    const root = pane(1);
    const s = split(root, 1, "h", 2);
    expect(s).toEqual({ kind: "split", orient: "h", ratio: 0.5, a: pane(1), b: pane(2) });
    expect(remove(s, 2)).toEqual(root);
    expect(remove(s, 1)).toEqual(pane(2));
  });
  test("split a nested pane", () => {
    const s = split(split(pane(1), 1, "h", 2), 2, "v", 3);
    expect(paneIds(s)).toEqual([1, 2, 3]);
    expect(remove(s, 3)).toEqual(split(pane(1), 1, "h", 2));
  });
  test("removing the last pane gives null", () => expect(remove(pane(1), 1)).toBeNull());
  test("removing an unknown pane changes nothing", () => expect(remove(pane(1), 9)).toEqual(pane(1)));
});

describe("layouts", () => {
  test("magica: five panes, equal splits, in tree order", () => {
    let id = 0;
    const names: string[] = [];
    const n = build(LAYOUTS.magica, (name) => { names.push(name); return pane(++id); });
    expect(paneIds(n)).toEqual([1, 2, 3, 4, 5]);
    expect(names).toEqual(["madoka", "homura", "sayaka", "mami", "kyoko"]);
    expect(ratios(n)).toEqual([0.5, 0.5, 1 / 3, 0.5]);
    expect(n.kind === "split" && n.orient).toBe("v");
  });
  test("pair", () => {
    let id = 0;
    const n = build(LAYOUTS.pair, () => pane(++id));
    expect(n).toEqual({ kind: "split", orient: "h", ratio: 0.5, a: pane(1), b: pane(2) });
  });
});

describe("moving focus", () => {
  // a 3-wide, 2-high grid of 100x100 panes: ids 1 2 3 / 4 5 6
  const centres = new Map<number, { x: number; y: number }>();
  [1, 2, 3, 4, 5, 6].forEach((id, i) => centres.set(id, { x: (i % 3) * 100 + 50, y: Math.floor(i / 3) * 100 + 50 }));
  test("each direction", () => {
    expect(neighbour(centres, 5, -1, 0)).toBe(4);
    expect(neighbour(centres, 5, 1, 0)).toBe(6);
    expect(neighbour(centres, 5, 0, -1)).toBe(2);
    expect(neighbour(centres, 2, 0, 1)).toBe(5);
    expect(neighbour(centres, 1, -1, 0)).toBeNull();
  });
  test("prefers the pane in line over a nearer diagonal one", () => {
    const c = new Map([[1, { x: 50, y: 50 }], [2, { x: 150, y: 120 }], [3, { x: 260, y: 50 }]]);
    expect(neighbour(c, 1, 1, 0)).toBe(3);
  });
});
