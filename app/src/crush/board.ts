// Magica Crush's rules, without any drawing (a port of the old app's CrushBoard). grid[r][c] is a Tile, r = 0 at the top.

export type Pos = [number, number];
/** null, "h" / "v" (striped: clears its row / column), "wrapped" (3x3 blast), "armed" (a wrapped head that went off
 * once and goes off again after the next fall) or "bomb" (Kyubey: clears every head of one character). */
export type Special = null | "h" | "v" | "wrapped" | "armed" | "bomb";
/** [what went off, row, column, character]: h / v / wrapped / armed / bomb, or a combo's board / cross / blast. */
export type Fire = [string, number, number, number | null];

export interface Rng {
  random(): number;
  randrange(n: number): number;
  choice<T>(items: readonly T[]): T;
  shuffle<T>(items: T[]): void;
  sample<T>(items: readonly T[], k: number): T[];
}

/** A seeded random source (mulberry32), or Math.random without a seed. */
export function rngFrom(seed?: number): Rng {
  let s = (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randrange = (n: number) => Math.floor(random() * n);
  return {
    random,
    randrange,
    choice: (items) => items[randrange(items.length)],
    shuffle(items) {
      for (let i = items.length - 1; i > 0; i--) {
        const j = randrange(i + 1);
        [items[i], items[j]] = [items[j], items[i]];
      }
    },
    sample(items, k) {
      const copy = [...items];
      this.shuffle(copy);
      return copy.slice(0, k);
    },
  };
}

let nextId = 0;

export class Tile {
  readonly id = nextId++;
  readonly bornKind: number | null;
  constructor(public kind: number | null, public special: Special = null) {
    this.bornKind = kind;
  }
}

/** One round of clearing and falling, for the view to animate in order: transforms (heads turned special by a Kyubey
 * combo), fires (specials going off), clears, created (heads that became specials), then falls. */
export class Step {
  score = 0;
  transforms: [Tile, number, number][] = [];
  fires: Fire[] = [];
  clears: [Tile, number, number][] = [];
  created: [Tile, number, number][] = [];
  /** [tile, column, from row (negative: above the board), to row] */
  falls: [Tile, number, number, number][] = [];
  constructor(public combo: number) {}
}

type Run = [Pos[], "h" | "v"];

const k = (p: Pos) => `${p[0]},${p[1]}`;
const unk = (s: string): Pos => s.split(",").map(Number) as Pos;
const cmp = (a: Pos, b: Pos) => a[0] - b[0] || a[1] - b[1];

export interface BoardOpts {
  size?: number;
  kinds?: number;
  rng?: Rng;
  luck?: number;
  stripes?: number;
  fade?: number;
}

export class CrushBoard {
  n: number;
  kinds: number;
  rng: Rng;
  luck: number;
  stripes: number;
  fade: number;
  grid: (Tile | null)[][] = [];

  constructor(o: BoardOpts = {}) {
    this.n = o.size ?? 8;
    this.kinds = o.kinds ?? 5;
    this.rng = o.rng ?? rngFrom();
    this.luck = o.luck ?? 0.4;
    this.stripes = o.stripes ?? 0.05;
    this.fade = o.fade ?? 0.72;
    this.grid = this.fresh();
  }

  cells(): Pos[] {
    const out: Pos[] = [];
    for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) out.push([r, c]);
    return out;
  }

  at(p: Pos): Tile | null {
    return this.grid[p[0]][p[1]];
  }

  kind(r: number, c: number): number | null {
    const t = r >= 0 && r < this.n && c >= 0 && c < this.n ? this.grid[r][c] : null;
    return t ? t.kind : null;
  }

  /** A random board with no matches and at least one move. */
  fresh(): (Tile | null)[][] {
    for (;;) {
      this.grid = Array.from({ length: this.n }, () => Array<Tile | null>(this.n).fill(null));
      for (const [r, c] of this.cells()) {
        const banned = new Set<number | null>();
        if (c >= 2 && this.kind(r, c - 1) === this.kind(r, c - 2)) banned.add(this.kind(r, c - 1));
        if (r >= 2 && this.kind(r - 1, c) === this.kind(r - 2, c)) banned.add(this.kind(r - 1, c));
        const options = [...Array(this.kinds).keys()].filter((x) => !banned.has(x));
        this.grid[r][c] = new Tile(this.rng.choice(options));
      }
      if (this.hint()) return this.grid;
    }
  }

  // ── matching ──

  /** Straight lines of 3 or more of the same character. */
  runs(): Run[] {
    const runs: Run[] = [];
    for (const horizontal of [true, false]) {
      for (let a = 0; a < this.n; a++) {
        let b = 0;
        while (b < this.n) {
          const [r, c] = horizontal ? [a, b] : [b, a];
          const kd = this.kind(r, c);
          let end = b + 1;
          while (kd !== null && end < this.n && (horizontal ? this.kind(a, end) : this.kind(end, a)) === kd) end++;
          if (kd !== null && end - b >= 3) {
            const cells: Pos[] = [];
            for (let i = b; i < end; i++) cells.push(horizontal ? [a, i] : [i, a]);
            runs.push([cells, horizontal ? "h" : "v"]);
          }
          b = end;
        }
      }
    }
    return runs;
  }

  /** Runs that touch merge into one group (an L, T or + shape). */
  groups(): Run[][] {
    let groups: Run[][] = [];
    for (const run of this.runs()) {
      const mine = new Set(run[0].map(k));
      const touching = groups.filter((g) => g.some((r) => r[0].some((p) => mine.has(k(p)))));
      const merged = [run, ...touching.flat()];
      groups = [...groups.filter((g) => !touching.includes(g)), merged];
    }
    return groups;
  }

  matchesAt(p: Pos): boolean {
    return this.matchSize(p) > 0;
  }

  /** How many heads the lines of 3+ through p hold (0 = no match there). */
  matchSize([r, c]: Pos): number {
    const kd = this.kind(r, c);
    if (kd === null) return 0;
    let size = 1;
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      let length = 1;
      for (const sign of [1, -1]) {
        let i = 1;
        while (this.kind(r + sign * dr * i, c + sign * dc * i) === kd) {
          length++;
          i++;
        }
      }
      if (length >= 3) size += length - 1;
    }
    return size >= 3 ? size : 0;
  }

  /** The special a group leaves behind and where: 5+ in a line → bomb, L / T / + → wrapped, 4 → striped across the
   * match. It goes where the player moved a head, else at the crossing or the middle of the run. */
  specialFor(group: Run[], swap: Pos[] | null): [Special, Pos | null] {
    const longest = group.reduce((a, b) => (b[0].length > a[0].length ? b : a));
    const orientations = new Set(group.map(([, o]) => o));
    let special: Special;
    if (longest[0].length >= 5) special = "bomb";
    else if (orientations.size === 2) special = "wrapped";
    else if (longest[0].length === 4) special = longest[1] === "h" ? "v" : "h";
    else return [null, null];
    const cells = new Set(group.flatMap(([run]) => run.map(k)));
    const moved = (swap ?? []).filter((p) => cells.has(k(p)));
    let pos: Pos;
    if (moved.length) pos = moved[0];
    else if (special === "wrapped") {
      const h = new Set(group.filter(([, o]) => o === "h").flatMap(([run]) => run.map(k)));
      const both = group.filter(([, o]) => o === "v").flatMap(([run]) => run).filter((p) => h.has(k(p)));
      pos = both.sort(cmp)[0];
    } else pos = longest[0][Math.floor(longest[0].length / 2)];
    if (this.at(pos)!.special) {   // don't overwrite a special: use a plain head of the group, if any
      const plain = [...cells].map(unk).filter((p) => !this.at(p)!.special).sort(cmp);
      if (!plain.length) return [null, null];
      pos = plain[0];
    }
    return [special, pos];
  }

  // ── specials ──

  /** Cells a special hits when it goes off. */
  effect(tile: Tile, [r, c]: Pos, step: Step): Pos[] {
    let hit: Pos[];
    if (tile.special === "h") hit = [...Array(this.n).keys()].map((i) => [r, i] as Pos);
    else if (tile.special === "v") hit = [...Array(this.n).keys()].map((i) => [i, c] as Pos);
    else if (tile.special === "wrapped" || tile.special === "armed") {
      hit = [];
      for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) hit.push([r + dr, c + dc]);
    } else {   // a bomb set off by another special picks a character at random
      const present = [...new Set(this.grid.flat().filter((t) => t && t.kind !== null).map((t) => t!.kind!))].sort((a, b) => a - b);
      const kind = present.length ? this.rng.choice(present) : null;
      step.fires.push(["bomb", r, c, kind]);
      return this.cells().filter((q) => this.at(q) !== null && this.at(q)!.kind === kind);
    }
    step.fires.push([tile.special!, r, c, tile.kind]);
    return hit.filter(([a, b]) => a >= 0 && a < this.n && b >= 0 && b < this.n);
  }

  /** Clear `start`, setting off every special in the way (and every special those hit, …). */
  explode(start: Pos[], protectedCells: Set<string>, step: Step): Set<string> {
    const queue = [...start];
    const cleared = new Set<string>(), fired = new Set<number>();
    while (queue.length) {
      const p = queue.pop()!;
      const t = this.at(p);
      if (cleared.has(k(p)) || protectedCells.has(k(p)) || t === null) continue;
      if (t.special && !fired.has(t.id)) {
        fired.add(t.id);
        queue.push(...this.effect(t, p, step));
        if (t.special === "wrapped") {   // stays, and goes off again after the fall
          t.special = "armed";
          protectedCells.add(k(p));
          continue;
        }
      }
      cleared.add(k(p));
    }
    return cleared;
  }

  /** Heads fall into the gaps and new ones drop in from above. During a chain (combo >= 1) the new ones are luckier,
   * less so each step: some copy the head below or to their left, and a few come striped. */
  gravity(combo = 0): [Tile, number, number, number][] {
    const luck = combo ? this.luck * this.fade ** (combo - 1) : 0;
    const stripes = combo ? this.stripes * this.fade ** (combo - 1) : 0;
    const falls: [Tile, number, number, number][] = [];
    for (let c = 0; c < this.n; c++) {
      const column: [number, Tile][] = [];
      for (let r = 0; r < this.n; r++) if (this.grid[r][c]) column.push([r, this.grid[r][c]!]);
      const fresh = this.n - column.length;
      const added: Tile[] = Array(fresh);
      for (let i = fresh - 1; i >= 0; i--) {   // bottom up, so the head below is already known
        const below = i + 1 < fresh ? added[i + 1] : column.length ? column[0][1] : null;
        const near = [below, c ? this.grid[i][c - 1] : null].filter((t): t is Tile => !!t && t.kind !== null).map((t) => t.kind!);
        const kind = near.length && this.rng.random() < luck ? this.rng.choice(near) : this.rng.randrange(this.kinds);
        added[i] = new Tile(kind, this.rng.random() < stripes ? this.rng.choice<Special>(["h", "v"]) : null);
      }
      added.forEach((t, i) => falls.push([t, c, i - fresh, i]));   // start above the board
      column.forEach(([r, t], i) => { if (r !== fresh + i) falls.push([t, c, r, fresh + i]); });
      [...added, ...column.map(([, t]) => t)].forEach((t, r) => (this.grid[r][c] = t));
    }
    return falls;
  }

  // ── a turn ──

  /** Clear matches (and `seeds`), let heads fall, and repeat while anything is left to clear. */
  resolve(swap: Pos[] | null = null, seeds: Pos[] = [], fires: Fire[] = [], transforms: [Tile, number, number][] = []): Step[] {
    const steps: Step[] = [];
    let combo = 0;
    let seedSet = new Set(seeds.map(k));
    for (;;) {
      const groups = this.groups();
      const armed = this.cells().filter((p) => this.at(p)!.special === "armed").map(k);
      if (!groups.length && !seedSet.size && !armed.length) return steps;
      combo++;
      const step = new Step(combo);
      step.fires.push(...fires);
      step.transforms.push(...transforms);
      fires = [];
      transforms = [];
      const prot = new Set<string>(), matched = new Set<string>();
      let score = 0;
      for (const group of groups) {
        for (const [run] of group) score += 10 * run.length * (run.length - 1);   // 3 → 60, 4 → 120, 5 → 200, …
        for (const [run] of group) run.forEach((p) => matched.add(k(p)));
        const [special, pos] = this.specialFor(group, swap);
        if (special && pos) {
          const t = this.at(pos)!;
          t.special = special;
          if (special === "bomb") t.kind = null;
          prot.add(k(pos));
          step.created.push([t, pos[0], pos[1]]);
        }
      }
      const start = new Set([...[...matched].filter((p) => !prot.has(p)), ...seedSet, ...armed]);
      const cleared = this.explode([...start].map(unk), prot, step);
      score += 20 * [...cleared].filter((p) => !matched.has(p)).length;   // heads cleared by specials
      step.score = score * combo;
      step.clears = [...cleared].map(unk).sort(cmp).map((p) => [this.at(p)!, p[0], p[1]]);
      for (const p of cleared) {
        const [r, c] = unk(p);
        this.grid[r][c] = null;
      }
      step.falls = this.gravity(combo);
      steps.push(step);
      swap = null;
      seedSet = new Set();
    }
  }

  /** Swap two neighbours: null if that's not a move, else the Steps it sets off. */
  swap(a: Pos, b: Pos): Step[] | null {
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return null;
    const ta = this.at(a)!, tb = this.at(b)!;
    this.grid[a[0]][a[1]] = tb;
    this.grid[b[0]][b[1]] = ta;
    // Kyubey bomb: swapped with a head, clears every head of that character (striped / wrapped: they all turn into
    // that special first); two bombs clear the board
    const bombs = ([[ta, b], [tb, a]] as [Tile, Pos][]).filter(([t]) => t.special === "bomb");
    if (bombs.length) {
      if (bombs.length === 2) {
        ta.special = tb.special = null;
        return this.resolve(null, this.cells(), [["board", b[0], b[1], null]]);
      }
      const [bomb, bp] = bombs[0];
      const [other] = bomb === ta ? [tb, a] : [ta, b];
      bomb.special = null;
      const kind = other.kind;
      const transforms: [Tile, number, number][] = [];
      const targets = this.cells().filter((p) => this.at(p)!.kind === kind);
      if (other.special && ["h", "v", "wrapped", "armed"].includes(other.special)) {
        for (const p of targets) {
          const t = this.at(p)!;
          if (!t.special) {
            t.special = other.special === "h" || other.special === "v" ? this.rng.choice<Special>(["h", "v"]) : "wrapped";
            transforms.push([t, p[0], p[1]]);
          }
        }
      }
      return this.resolve(null, [...targets, bp], [["bomb", bp[0], bp[1], kind]], transforms);
    }
    // two specials together: striped + striped → a row and a column, striped + wrapped → 3 rows and 3 columns,
    // wrapped + wrapped → a 5x5 blast
    if (ta.special && tb.special) {
      const striped = [ta, tb].filter((t) => t.special === "h" || t.special === "v").length;
      if (striped === 2) {
        [ta.special, tb.special] = a[0] === b[0] ? ["h", "v"] : ["v", "h"];
        return this.resolve(null, [a, b]);
      }
      ta.special = tb.special = null;
      const [r, c] = b;
      if (striped === 1) {
        const seeds = this.cells().filter((p) => Math.abs(p[0] - r) <= 1 || Math.abs(p[1] - c) <= 1);
        return this.resolve(null, seeds, [["cross", r, c, ta.kind]]);
      }
      const seeds = this.cells().filter((p) => Math.abs(p[0] - r) <= 2 && Math.abs(p[1] - c) <= 2);
      return this.resolve(null, seeds, [["blast", r, c, ta.kind]]);
    }
    if (!(this.matchesAt(a) || this.matchesAt(b))) {
      this.grid[a[0]][a[1]] = ta;
      this.grid[b[0]][b[1]] = tb;
      return null;
    }
    return this.resolve([b, a]);
  }

  /** Every pair of neighbours that makes a move, with a rough worth: heads matched, and swaps of two specials or a
   * bomb above any match. */
  moves(): [Pos, Pos, number][] {
    const out: [Pos, Pos, number][] = [];
    for (const p of this.cells()) {
      for (const q of [[p[0], p[1] + 1], [p[0] + 1, p[1]]] as Pos[]) {
        if (q[0] >= this.n || q[1] >= this.n) continue;
        const tp = this.at(p)!, tq = this.at(q)!;
        if (tp.special === "bomb" || tq.special === "bomb" || (tp.special && tq.special)) {
          out.push([p, q, 100]);
          continue;
        }
        this.grid[p[0]][p[1]] = tq;
        this.grid[q[0]][q[1]] = tp;
        const worth = this.matchSize(p) + this.matchSize(q);
        this.grid[p[0]][p[1]] = tp;
        this.grid[q[0]][q[1]] = tq;
        if (worth) out.push([p, q, worth]);
      }
    }
    return out;
  }

  /** A pair of neighbours that makes a move, or null. */
  hint(): [Pos, Pos] | null {
    const m = this.moves()[0];
    return m ? [m[0], m[1]] : null;
  }

  /** Autoplay's move: one of the worthiest (a random one of them), or null. */
  bestMove(): [Pos, Pos] | null {
    const moves = this.moves();
    if (!moves.length) return null;
    const top = Math.max(...moves.map((m) => m[2]));
    const [p, q] = this.rng.choice(moves.filter((m) => m[2] === top));
    return [p, q];
  }

  /** Rearrange the heads (specials included) until there's a move and nothing matches already. */
  shuffle(): void {
    const tiles = this.grid.flat();
    for (let i = 0; i < 200; i++) {
      this.rng.shuffle(tiles);
      this.grid = Array.from({ length: this.n }, (_, r) => tiles.slice(r * this.n, (r + 1) * this.n));
      if (!this.runs().length && this.hint()) return;
    }
    this.grid = this.fresh();
  }
}
