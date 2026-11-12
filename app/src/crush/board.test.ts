// Rules of `crush`, ported one to one from the old app's tests (tests/test_crush.py).
import { describe, expect, test } from "vitest";
import { CrushBoard, Pos, rngFrom, Special, Step, Tile } from "./board";

const X = 5; // a character the base pattern never uses, so test pieces only match each other

type Edit = number | [number | null, Special];
function board(edits: Record<string, Edit> = {}, seed = 1, check = true): CrushBoard {
  const b = new CrushBoard({ kinds: 6, rng: rngFrom(seed) });
  b.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => new Tile((2 * r + c) % 5)));
  for (const [k, v] of Object.entries(edits)) {
    const [r, c] = k.split(",").map(Number);
    b.grid[r][c] = Array.isArray(v) ? new Tile(v[0], v[1]) : new Tile(v);
  }
  if (check) expect(b.runs(), "test board already has a match").toEqual([]);
  return b;
}
const key = (p: Pos) => `${p[0]},${p[1]}`;
const cleared = (s: Step) => new Set(s.clears.map(([, r, c]) => `${r},${c}`));
const sub = (a: Iterable<string>, b: Set<string>) => [...a].every((x) => b.has(x));
const cells = (f: (r: number, c: number) => boolean) => {
  const out: string[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (f(r, c)) out.push(`${r},${c}`);
  return out;
};

describe("matching", () => {
  test("fresh boards have no matches and a move", () => {
    for (let seed = 0; seed < 50; seed++) {
      const b = new CrushBoard({ rng: rngFrom(seed) });
      expect(b.runs()).toEqual([]);
      expect(b.hint()).not.toBeNull();
    }
  });
  test("swap without a match is undone", () => {
    const b = board();
    const before = b.grid.map((row) => row.map((t) => t!.id));
    expect(b.swap([0, 0], [0, 1])).toBeNull();
    expect(b.grid.map((row) => row.map((t) => t!.id))).toEqual(before);
  });
  test("not neighbours", () => expect(board().swap([0, 0], [0, 2])).toBeNull());
  test("three in a row", () => {
    const b = board({ "0,0": X, "0,1": X, "1,2": X });
    const steps = b.swap([1, 2], [0, 2])!;
    expect(steps.length).toBeGreaterThan(0);
    expect(cleared(steps[0])).toEqual(new Set(["0,0", "0,1", "0,2"]));
    expect(steps[0].score).toBe(60);
    expect(steps[0].created).toEqual([]);
  });
  test("board is full after a turn", () => {
    const b = board({ "0,0": X, "0,1": X, "1,2": X });
    b.swap([1, 2], [0, 2]);
    expect(b.grid.every((row) => row.every((t) => t !== null))).toBe(true);
    expect(b.runs()).toEqual([]);
  });
  test("hint is a move", () => {
    const b = board({ "0,0": X, "0,1": X, "1,2": X });
    const h = b.hint()!;
    expect(b.moves().map(([p, q]) => key(p) + key(q))).toContain(key(h[0]) + key(h[1]));
  });
  test("autoplay picks the bigger match", () => {
    const b = board({ "0,0": X, "0,1": X, "1,2": X, "5,0": X, "5,1": X, "5,3": X, "6,2": X });
    expect(b.bestMove()).toEqual([[5, 2], [6, 2]]);
  });
  test("autoplay sets off a bomb first", () => {
    const b = board({ "5,0": X, "5,1": X, "5,3": X, "6,2": X, "2,3": [0, "bomb"] });
    expect(b.bestMove()!.map(key)).toContain("2,3");
  });
  test("autoplay has no move on a stuck board", () => {
    const b = board();
    b.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => new Tile(((r + c) % 2) * 5 + ((r + c) % 3))));
    expect(b.moves()).toEqual([]);
    expect(b.bestMove()).toBeNull();
  });
});

describe("specials", () => {
  test("four makes a striped head where you moved", () => {
    const b = board({ "3,0": X, "3,1": X, "3,3": X, "4,2": X });
    const steps = b.swap([4, 2], [3, 2])!;
    const [t, r, c] = steps[0].created[0];
    expect([t.special, t.kind, r, c]).toEqual(["v", X, 3, 2]);
    expect(cleared(steps[0])).toEqual(new Set(["3,0", "3,1", "3,3"]));
    expect(steps[0].score).toBe(120);
  });
  test("five makes a bomb", () => {
    const b = board({ "5,0": X, "5,1": X, "5,3": X, "5,4": X, "6,2": X });
    const steps = b.swap([6, 2], [5, 2])!;
    const [t, r, c] = steps[0].created[0];
    expect([t.special, t.kind, r, c]).toEqual(["bomb", null, 5, 2]);
    expect(cleared(steps[0])).toEqual(new Set(["5,0", "5,1", "5,3", "5,4"]));
    expect(steps[0].score).toBe(200);
  });
  test("long runs clear whole and score more", () => {
    const e: Record<string, Edit> = {};
    for (let c = 0; c < 7; c++) e[`5,${c}`] = X;
    const b = board(e, 1, false);
    const steps = b.resolve();
    expect(steps[0].score).toBe(7 * 6 * 10);
    expect(steps[0].created[0][0].special).toBe("bomb");
    expect(cleared(steps[0]).size).toBe(6);
  });
  test("L shape makes a wrapped head", () => {
    const b = board({ "2,0": X, "2,1": X, "0,2": X, "1,2": X, "3,2": X });
    const steps = b.swap([3, 2], [2, 2])!;
    const [t, r, c] = steps[0].created[0];
    expect([t.special, r, c]).toEqual(["wrapped", 2, 2]);
  });
  test("striped clears its row and sets off another", () => {
    const b = board({ "4,0": [X, "h"], "4,1": X, "5,2": X, "4,7": [0, "v"] });
    const steps = b.swap([5, 2], [4, 2])!;
    const hit = cleared(steps[0]);
    expect(sub(cells((r) => r === 4), hit)).toBe(true);
    expect(sub(cells((_, c) => c === 7), hit)).toBe(true);
    expect(steps[0].fires.map((f) => f[0])).toEqual(["h", "v"]);
  });
  test("wrapped goes off twice", () => {
    const b = board({ "4,3": [X, "wrapped"], "4,4": X, "5,5": X });
    const steps = b.swap([5, 5], [4, 5])!;
    const first = cleared(steps[0]);
    expect(first.has("4,3")).toBe(false);
    expect(sub(["3,2", "5,4", "5,2"], first)).toBe(true);
    expect(steps.slice(1).some((s) => s.fires.some((f) => f[0] === "armed"))).toBe(true);
    expect(b.grid.some((row) => row.some((t) => t!.special === "armed"))).toBe(false);
  });
  test("bomb with a head clears that character", () => {
    const b = board({ "0,0": [null, "bomb"] });
    const kind = b.at([0, 1])!.kind;
    const targets = b.cells().filter((p) => b.at(p)!.kind === kind).map(key);
    const steps = b.swap([0, 0], [0, 1])!;
    expect(sub(targets, cleared(steps[0]))).toBe(true);
    expect(steps[0].fires[0][0]).toBe("bomb");
  });
  test("bomb with striped turns them all striped", () => {
    const b = board({ "0,0": [null, "bomb"], "0,1": [1, "h"] });
    const steps = b.swap([0, 0], [0, 1])!;
    expect(steps[0].transforms.length).toBeGreaterThan(0);
    expect(steps[0].transforms.every(([t]) => t.special === "h" || t.special === "v")).toBe(true);
  });
  test("two bombs clear the board", () => {
    const b = board({ "0,0": [null, "bomb"], "0,1": [null, "bomb"] });
    expect(cleared(b.swap([0, 0], [0, 1])![0]).size).toBe(64);
  });
  test("two striped clear a row and a column", () => {
    const b = board({ "3,3": [0, "h"], "3,4": [1, "h"] });
    const hit = cleared(b.swap([3, 3], [3, 4])![0]);
    expect(sub(cells((r) => r === 3), hit)).toBe(true);
    expect([3, 4].some((c) => sub(cells((_, cc) => cc === c), hit))).toBe(true);
  });
  test("wrapped and wrapped is a 5x5 blast", () => {
    const b = board({ "3,3": [0, "wrapped"], "3,4": [1, "wrapped"] });
    const hit = cleared(b.swap([3, 3], [3, 4])![0]);
    expect(sub(cells((r, c) => r >= 1 && r <= 5 && c >= 2 && c <= 6), hit)).toBe(true);
  });
});

describe("turns", () => {
  test("falls move heads down and drop new ones", () => {
    const b = board({ "0,0": X, "0,1": X, "1,2": X });
    const above = b.at([1, 0]);
    const steps = b.swap([1, 2], [0, 2])!;
    const drops = steps[0].falls.filter(([, , fr]) => fr < 0).map(([, c, fr, to]) => [c, fr, to]);
    expect(drops.sort()).toEqual([[0, -1, 0], [1, -1, 0], [2, -1, 0]]);
    expect(b.at([1, 0])).toBe(above);
  });
  test("cascades multiply", () => {
    for (let seed = 0; seed < 200; seed++) {
      const b = board({ "0,0": X, "0,1": X, "1,2": X }, seed);
      const steps = b.swap([1, 2], [0, 2])!;
      if (steps.length > 1) {
        expect(steps.map((s) => s.combo)).toEqual(steps.map((_, i) => i + 1));
        expect(steps[1].score % 2).toBe(0);
        return;
      }
    }
    throw new Error("no cascade in 200 seeds");
  });
  test("chain luck makes longer chains that still end", () => {
    const chains = (luck: number, stripes: number) => {
      const lens: number[] = [];
      for (let seed = 0; seed < 20; seed++) {
        const b = new CrushBoard({ rng: rngFrom(seed), luck, stripes, fade: 0.72 });
        for (let i = 0; i < 30; i++) {
          const move = b.hint();
          if (!move) { b.shuffle(); continue; }
          lens.push(b.swap(...move)!.length);
        }
      }
      return [lens.reduce((a, b) => a + b, 0) / lens.length, Math.max(...lens)];
    };
    const plain = chains(0, 0), lucky = chains(0.4, 0.05);
    expect(lucky[0]).toBeGreaterThan(plain[0] * 1.3);
    expect(lucky[1]).toBeLessThan(30);
  });
  test("no luck outside a chain", () => {
    const b = board();
    for (let c = 0; c < 8; c++) b.grid[0][c] = null;
    b.luck = 1;
    b.stripes = 1;
    b.gravity();
    expect(b.grid[0].some((t) => t!.special)).toBe(false);
  });
  test("shuffle leaves a move and no matches", () => {
    const b = board();
    const ids = b.grid.flat().map((t) => t!.id).sort();
    b.shuffle();
    expect(b.grid.flat().map((t) => t!.id).sort()).toEqual(ids);
    expect(b.runs()).toEqual([]);
    expect(b.hint()).not.toBeNull();
  });
  test("random games stay consistent", () => {
    for (let seed = 0; seed < 30; seed++) {
      const rng = rngFrom(seed + 1000);
      const b = new CrushBoard({ rng: rngFrom(seed) });
      for (let i = 0; i < 60; i++) {
        for (const p of rng.sample(b.cells(), 3)) b.at(p)!.special = rng.choice<Special>(["h", "v", "wrapped", null, null]);
        if (b.runs().length) b.resolve();
        const move = b.hint();
        if (!move) { b.shuffle(); continue; }
        const steps = b.swap(...move)!;
        expect(steps.length).toBeGreaterThan(0);
        expect(b.grid.every((row) => row.every((t) => t !== null))).toBe(true);
        expect(b.runs()).toEqual([]);
        expect(b.grid.some((row) => row.some((t) => t!.special === "armed"))).toBe(false);
        for (const s of steps) expect(s.clears.length + s.created.length).toBeGreaterThan(0);
      }
    }
  });
});
