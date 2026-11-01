// Magica Crush (`crush` in the shell): a pixel-art match-3 game with the characters' soul gems, over a pane. A port of
// CrushBoard / Crush in ../magica-terminal. The rules (Tile, Step, CrushBoard) don't draw anything, so the tests
// (test/crush.test.js) run them under Node; the game itself (Crush) uses renderer.js's settings, themes and helpers.
'use strict';

class Rng {
  // seedable random numbers (mulberry32), with the bits of Python's random.Random the rules use
  constructor(seed = Math.floor(Math.random() * 2 ** 32)) {
    this.state = seed >>> 0;
  }

  random() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  }

  randrange(n) { return Math.floor(this.random() * n); }

  choice(items) { return items[this.randrange(items.length)]; }

  shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randrange(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}


class Tile {
  // A head on the board. kind: index into CHARACTERS (null for a Kyubey bomb). special: null, "h" / "v" (striped:
  // clears its row / column), "wrapped" (3x3 blast), "armed" (a wrapped head that went off once and goes off again
  // after the next fall) or "bomb" (Kyubey: clears every head of one character).
  static nextId = 0;

  constructor(kind, special = null) {
    this.kind = kind;
    this.special = special;
    this.id = Tile.nextId++;
    this.bornKind = kind;
  }
}


class Step {
  // One round of clearing and falling, for the game to animate in order: transforms (heads turned special by a Kyubey
  // combo), fires (specials going off), clears, created (heads that became specials), then falls.
  // fires: [special, r, c, kind]; transforms / clears / created: [tile, r, c]; falls: [tile, column, from row, to row]
  constructor(combo) {
    this.combo = combo;
    this.score = 0;
    this.transforms = []; this.fires = []; this.clears = []; this.created = []; this.falls = [];
  }
}


class CrushBoard {
  // The rules, without any drawing: grid[r][c] is a Tile (r = 0 at the top). Cells are [r, c]; sets of cells hold
  // their keys (r * n + c). luck / stripes / fade are CRUSH_CHAIN_LUCK / CRUSH_LUCKY_STRIPES / CRUSH_CHAIN_FADE (the
  // game passes them; left out, heads dropping in during a chain are no luckier than any other).
  constructor({ size = 8, kinds = 5, rng = new Rng(), luck = 0, stripes = 0, fade = 1 } = {}) {
    this.n = size;
    this.kinds = kinds;
    this.rng = rng;
    this.luck = luck; this.stripes = stripes; this.fade = fade;
    this.grid = this.fresh();
  }

  key(p) { return p[0] * this.n + p[1]; }

  pos(k) { return [Math.floor(k / this.n), k % this.n]; }

  cells() {
    const out = [];
    for (let r = 0; r < this.n; r++) for (let c = 0; c < this.n; c++) out.push([r, c]);
    return out;
  }

  at(p) { return this.grid[p[0]][p[1]]; }

  kind(r, c) {
    const t = r >= 0 && r < this.n && c >= 0 && c < this.n ? this.grid[r][c] : null;
    return t ? t.kind : null;
  }

  fresh() {   // a random board with no matches and at least one move
    for (;;) {
      this.grid = Array.from({ length: this.n }, () => Array(this.n).fill(null));
      for (const [r, c] of this.cells()) {
        const banned = new Set();
        if (c >= 2 && this.kind(r, c - 1) === this.kind(r, c - 2)) banned.add(this.kind(r, c - 1));
        if (r >= 2 && this.kind(r - 1, c) === this.kind(r - 2, c)) banned.add(this.kind(r - 1, c));
        const allowed = [];
        for (let k = 0; k < this.kinds; k++) if (!banned.has(k)) allowed.push(k);
        this.grid[r][c] = new Tile(this.rng.choice(allowed));
      }
      if (this.hint()) return this.grid;
    }
  }

  // ── matching ──
  runs() {   // straight lines of 3 or more of the same character: [[cells, "h" or "v"]]
    const runs = [];
    for (const horizontal of [true, false]) {
      for (let a = 0; a < this.n; a++) {
        const cell = i => horizontal ? [a, i] : [i, a];
        let b = 0;
        while (b < this.n) {
          const k = this.kind(...cell(b));
          let end = b + 1;
          while (k !== null && end < this.n && this.kind(...cell(end)) === k) end++;
          if (k !== null && end - b >= 3) {
            const run = [];
            for (let i = b; i < end; i++) run.push(cell(i));
            runs.push([run, horizontal ? 'h' : 'v']);
          }
          b = end;
        }
      }
    }
    return runs;
  }

  groups() {   // runs that touch merge into one group (an L, T or + shape): [runs]
    let groups = [];
    for (const run of this.runs()) {
      const keys = new Set(run[0].map(p => this.key(p)));
      const touching = groups.filter(g => g.some(([cells]) => cells.some(p => keys.has(this.key(p)))));
      const merged = [run, ...touching.flat()];
      groups = [...groups.filter(g => !touching.includes(g)), merged];
    }
    return groups;
  }

  matchSize(p) {   // how many heads the lines of 3+ through `p` hold (0 = no match there)
    const [r, c] = p, k = this.kind(r, c);
    if (k === null) return 0;
    let size = 1;
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      let length = 1;
      for (const sign of [1, -1]) {
        let i = 1;
        while (this.kind(r + sign * dr * i, c + sign * dc * i) === k) { length++; i++; }
      }
      if (length >= 3) size += length - 1;
    }
    return size >= 3 ? size : 0;
  }

  specialFor(group, swap) {
    // The special a group leaves behind and where: 5+ in a line → bomb, L / T / + → wrapped, 4 → striped across the
    // match. It goes where the player moved a head, else at the crossing or the middle of the run.
    const longest = group.reduce((a, b) => b[0].length > a[0].length ? b : a);
    const orientations = new Set(group.map(([, o]) => o));
    let special;
    if (longest[0].length >= 5) special = 'bomb';
    else if (orientations.size === 2) special = 'wrapped';
    else if (longest[0].length === 4) special = longest[1] === 'h' ? 'v' : 'h';
    else return [null, null];
    const keysOf = runs => runs.flatMap(([run]) => run.map(p => this.key(p)));
    const cells = new Set(keysOf(group));
    const moved = (swap || []).filter(p => cells.has(this.key(p)));
    let pos;
    if (moved.length) {
      pos = moved[0];
    } else if (special === 'wrapped') {
      const h = new Set(keysOf(group.filter(([, o]) => o === 'h')));
      pos = this.pos(Math.min(...keysOf(group.filter(([, o]) => o === 'v')).filter(k => h.has(k))));
    } else {
      pos = longest[0][Math.floor(longest[0].length / 2)];
    }
    if (this.at(pos).special) {   // don't overwrite a special: use a plain head of the group, if any
      const plain = [...cells].filter(k => !this.at(this.pos(k)).special);
      if (!plain.length) return [null, null];
      pos = this.pos(Math.min(...plain));
    }
    return [special, pos];
  }

  // ── specials ──
  effect(tile, p, step) {   // cells a special hits when it goes off
    const [r, c] = p, n = this.n;
    let hit = [];
    if (tile.special === 'h') {
      for (let i = 0; i < n; i++) hit.push([r, i]);
    } else if (tile.special === 'v') {
      for (let i = 0; i < n; i++) hit.push([i, c]);
    } else if (tile.special === 'wrapped' || tile.special === 'armed') {
      for (const dr of [-1, 0, 1]) for (const dc of [-1, 0, 1]) hit.push([r + dr, c + dc]);
    } else {   // a bomb set off by another special picks a character at random
      const present = [...new Set(this.grid.flat().filter(t => t && t.kind !== null).map(t => t.kind))].sort((a, b) => a - b);
      const kind = present.length ? this.rng.choice(present) : null;
      step.fires.push(['bomb', r, c, kind]);
      return this.cells().filter(q => this.at(q) && this.at(q).kind === kind);
    }
    step.fires.push([tile.special, r, c, tile.kind]);
    return hit.filter(q => q[0] >= 0 && q[0] < n && q[1] >= 0 && q[1] < n);
  }

  explode(start, kept, step) {   // clear `start`, setting off every special in the way (and every special those hit, …)
    const queue = [...start], cleared = new Set(), fired = new Set();
    while (queue.length) {
      const k = queue.pop(), p = this.pos(k), t = this.at(p);
      if (cleared.has(k) || kept.has(k) || !t) continue;
      if (t.special && !fired.has(t.id)) {
        fired.add(t.id);
        queue.push(...this.effect(t, p, step).map(q => this.key(q)));
        if (t.special === 'wrapped') {   // stays, and goes off again after the fall
          t.special = 'armed';
          kept.add(k);
          continue;
        }
      }
      cleared.add(k);
    }
    return cleared;
  }

  gravity(combo = 0) {
    // Heads fall into the gaps and new ones drop in from above: [[tile, column, from row, to row]]. During a chain
    // (combo >= 1) the new ones are luckier, less so each step: some copy the head below or to their left, and a few
    // come striped.
    const luck = combo ? this.luck * this.fade ** (combo - 1) : 0;
    const stripes = combo ? this.stripes * this.fade ** (combo - 1) : 0;
    const falls = [];
    for (let c = 0; c < this.n; c++) {
      const column = [];
      for (let r = 0; r < this.n; r++) if (this.grid[r][c]) column.push([r, this.grid[r][c]]);
      const count = this.n - column.length;
      const drops = Array(count).fill(null);
      for (let i = count - 1; i >= 0; i--) {   // bottom up, so the head below is already known
        const below = i + 1 < count ? drops[i + 1] : (column.length ? column[0][1] : null);
        const near = [below, c ? this.grid[i][c - 1] : null].filter(t => t && t.kind !== null).map(t => t.kind);
        const kind = near.length && this.rng.random() < luck ? this.rng.choice(near) : this.rng.randrange(this.kinds);
        drops[i] = new Tile(kind, this.rng.random() < stripes ? this.rng.choice('hv') : null);
      }
      drops.forEach((t, i) => falls.push([t, c, i - count, i]));   // start above the board
      column.forEach(([r, t], i) => { if (r !== count + i) falls.push([t, c, r, count + i]); });
      [...drops, ...column.map(([, t]) => t)].forEach((t, r) => { this.grid[r][c] = t; });
    }
    return falls;
  }

  // ── a turn ──
  resolve({ swap = null, seeds = [], fires = [], transforms = [] } = {}) {
    // Clear matches (and `seeds`), let heads fall, and repeat while anything is left to clear: [Step].
    const steps = [];
    let combo = 0, seedKeys = new Set(seeds.map(p => this.key(p)));
    for (;;) {
      const groups = this.groups();
      const armed = this.cells().filter(p => this.at(p).special === 'armed').map(p => this.key(p));
      if (!groups.length && !seedKeys.size && !armed.length) return steps;
      combo++;
      const step = new Step(combo);
      step.fires.push(...fires);
      step.transforms.push(...transforms);
      fires = transforms = [];
      const kept = new Set(), matched = new Set();
      let score = 0;
      for (const group of groups) {
        for (const [run] of group) {
          score += 10 * run.length * (run.length - 1);   // 3 → 60, 4 → 120, 5 → 200, 6 → 300 …
          for (const p of run) matched.add(this.key(p));
        }
        const [special, pos] = this.specialFor(group, swap);
        if (special) {
          const t = this.at(pos);
          t.special = special;
          if (special === 'bomb') t.kind = null;
          kept.add(this.key(pos));
          step.created.push([t, ...pos]);
        }
      }
      const start = [...[...matched].filter(k => !kept.has(k)), ...seedKeys, ...armed];
      const cleared = this.explode(start, kept, step);
      score += 20 * [...cleared].filter(k => !matched.has(k)).length;   // heads cleared by specials
      step.score = score * combo;
      step.clears = [...cleared].sort((a, b) => a - b).map(k => [this.at(this.pos(k)), ...this.pos(k)]);
      for (const k of cleared) { const [r, c] = this.pos(k); this.grid[r][c] = null; }
      step.falls = this.gravity(combo);
      steps.push(step);
      swap = null;
      seedKeys = new Set();
    }
  }

  swap(a, b) {   // swap two neighbours: null if that's not a move, else the Steps it sets off
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return null;
    const ta = this.at(a), tb = this.at(b);
    this.grid[a[0]][a[1]] = tb; this.grid[b[0]][b[1]] = ta;
    // Kyubey bomb: swapped with a head, clears every head of that character (striped / wrapped: they all turn into
    // that special first); two bombs clear the board
    const bombs = [[ta, b], [tb, a]].filter(([t]) => t.special === 'bomb');
    if (bombs.length) {
      if (bombs.length === 2) {
        ta.special = tb.special = null;
        return this.resolve({ seeds: this.cells(), fires: [['board', ...b, null]] });
      }
      const [bomb, bp] = bombs[0];
      const other = bomb === ta ? tb : ta;
      bomb.special = null;
      const kind = other.kind, transforms = [];
      const targets = this.cells().filter(p => this.at(p).kind === kind);
      if (['h', 'v', 'wrapped', 'armed'].includes(other.special)) {
        for (const p of targets) {
          const t = this.at(p);
          if (!t.special) {
            t.special = other.special === 'h' || other.special === 'v' ? this.rng.choice('hv') : 'wrapped';
            transforms.push([t, ...p]);
          }
        }
      }
      return this.resolve({ seeds: [...targets, bp], fires: [['bomb', ...bp, kind]], transforms });
    }
    // two specials together: striped + striped → a row and a column, striped + wrapped → 3 rows and 3 columns,
    // wrapped + wrapped → a 5x5 blast
    if (ta.special && tb.special) {
      const striped = [ta, tb].filter(t => t.special === 'h' || t.special === 'v').length;
      if (striped === 2) {
        [ta.special, tb.special] = a[0] === b[0] ? ['h', 'v'] : ['v', 'h'];
        return this.resolve({ seeds: [a, b] });
      }
      ta.special = tb.special = null;
      const [r, c] = b;
      if (striped === 1) {
        const seeds = this.cells().filter(p => Math.abs(p[0] - r) <= 1 || Math.abs(p[1] - c) <= 1);
        return this.resolve({ seeds, fires: [['cross', r, c, ta.kind]] });
      }
      const seeds = this.cells().filter(p => Math.abs(p[0] - r) <= 2 && Math.abs(p[1] - c) <= 2);
      return this.resolve({ seeds, fires: [['blast', r, c, ta.kind]] });
    }
    if (!(this.matchSize(a) || this.matchSize(b))) {
      this.grid[a[0]][a[1]] = ta; this.grid[b[0]][b[1]] = tb;
      return null;
    }
    return this.resolve({ swap: [b, a] });
  }

  *moves() {
    // Every pair of neighbours that makes a move, with a rough worth: heads matched, and swaps of two specials or a
    // bomb above any match.
    for (const p of this.cells()) {
      for (const q of [[p[0], p[1] + 1], [p[0] + 1, p[1]]]) {
        if (q[0] >= this.n || q[1] >= this.n) continue;
        const tp = this.at(p), tq = this.at(q);
        if (tp.special === 'bomb' || tq.special === 'bomb' || (tp.special && tq.special)) {
          yield [p, q, 100];
          continue;
        }
        this.grid[p[0]][p[1]] = tq; this.grid[q[0]][q[1]] = tp;
        const worth = this.matchSize(p) + this.matchSize(q);
        this.grid[p[0]][p[1]] = tp; this.grid[q[0]][q[1]] = tq;
        if (worth) yield [p, q, worth];
      }
    }
  }

  hint() {   // a pair of neighbours that makes a move, or null
    for (const [p, q] of this.moves()) return [p, q];
    return null;
  }

  bestMove() {   // autoplay's move: one of the worthiest (a random one of them), or null
    const moves = [...this.moves()];
    if (!moves.length) return null;
    const top = Math.max(...moves.map(m => m[2]));
    const [p, q] = this.rng.choice(moves.filter(m => m[2] === top));
    return [p, q];
  }

  shuffle() {   // rearrange the heads (specials included) until there's a move and nothing matches already
    const tiles = this.grid.flat();
    for (let i = 0; i < 200; i++) {
      this.rng.shuffle(tiles);
      this.grid = Array.from({ length: this.n }, (_, r) => tiles.slice(r * this.n, (r + 1) * this.n));
      if (!this.runs().length && this.hint()) return;
    }
    this.grid = this.fresh();
  }
}


// The game is drawn on a small canvas of "art pixels" and scaled up by a whole number of device pixels with
// nearest-neighbour filtering, so everything (gems, text, sparks and motion) snaps to chunky pixels.
const CELL = 20;   // art pixels per board cell
// soul gems in their egg form: the same egg in a gold crown and cup, each in her colour (order of CHARACTERS)
const GEM_COLOURS = ['#ff6eb0', '#9a6bff', '#4f9dff', '#ffe94d', '#e3203a'];
const GEM_METAL = { G: '#e9b949', g: '#9b6a17', Y: '#fff0a6' };   // gold, its shadow and its shine
const GEM_CROWN = [   // drawn over the top of the egg (from row 1, centred); "." leaves the egg showing
  '....YY....',
  '...gGGg...',
  '.gGGYYGGg.',
  'gGYGGGGYGg',
  'g.G.gg.G.g',
];
const GEM_CUP = [     // …and under it (down to row 18: a gap between gems above and below)
  'g.G....G.g',
  'gGGGYYGGGg',
  '.gGGGGGGg.',
  '..gGYYGg..',
];
const KYUBEY_SPRITE = [   // the bomb: W white, R red, P pink (outlined like the gems)
  '..................',
  '.WW............WW.',
  '.WWW..........WWW.',
  '..WWWWWWWWWWWWWW..',
  '..WWWWWWWWWWWWWW..',
  '.WWWWWWWWWWWWWWWW.',
  '.WWWWWWWWWWWWWWWW.',
  '.WWWRRWWWWWWRRWWW.',
  '.WWWRRWWWWWWRRWWW.',
  '.WWWWWWWWWWWWWWWW.',
  '.WWWWWWWPPWWWWWWW.',
  '..WWWWWWWWWWWWWW..',
  '..PWWWWWWWWWWWWP..',
  '.PW.WWWWWWWWWW.WP.',
  '.W...WWWWWWWW...W.',
  '.W..............W.',
  '.P..............P.',
  '..................',
];
const FONT_3X5 = {   // pixel font: 3x5 glyphs, rows top to bottom
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010',
  8: '111101111101111', 9: '111101111001111', A: '010101111101101', B: '110101110101110',
  C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', K: '101101110101101',
  L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110',
  T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101',
  X: '101101010101101', Y: '101101010010010', Z: '111001010100111', '!': '010010010000010', '+': '000010111010000',
  '-': '000000111000000', ':': '000010000010000', ' ': '000000000000000',
};

const uniform = (a, b) => a + Math.random() * (b - a);
const samePos = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const shade = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));   // rgb a toward rgb b by fraction t

function outlinePixels(px, colour) {   // a 1-pixel outline around the opaque pixels
  const h = px.length, w = px[0].length;
  const out = px.map(row => [...row]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y][x][3] === 0 && [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dy, dx]) =>
        y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w && px[y + dy][x + dx][3])) {
        out[y][x] = [...colour, 255];
      }
    }
  }
  return out;
}

function gemPixels(kind, special) {
  // Her soul gem as a CELL x CELL sprite: an egg lit from the top-left (a facet, a glint, an outline) in its gold crown
  // and cup. Striped gems get light bands, wrapped ones are brighter; both are outlined in a light shade.
  const c = hexToRgb(GEM_COLOURS[kind]), white = [255, 255, 255], black = [0, 0, 0];
  const tones = [shade(c, white, 0.6), shade(c, white, 0.25), c, shade(c, black, 0.3), shade(c, black, 0.5)];
  const px = Array.from({ length: CELL }, () => Array(CELL).fill([0, 0, 0, 0]));
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = (x + 0.5 - CELL / 2) / 5.0, v = (y + 0.5 - 10) / 5.8;
      if ((u / (1 - 0.15 * Math.max(0, -v))) ** 2 + v * v <= 1) {   // an egg, narrower at the top
        const light = 0.55 * u + 0.7 * v - 0.25 * (1 - (u * u + v * v));
        let tone = tones[[-0.55, -0.2, 0.2, 0.5].filter(t => light >= t).length];
        if ((special === 'h' || special === 'v') && Math.floor((special === 'h' ? y : x) / 2) % 2 === 0) {
          tone = shade(tone, white, 0.55);
        } else if (special === 'wrapped' || special === 'armed') {
          tone = shade(tone, white, 0.25);
        }
        px[y][x] = [...tone, 255];
      }
    }
  }
  for (let d = -1; d < 3; d++) {   // a facet: a lighter diagonal through the middle
    const p = px[10 - d][10 + d];
    if (p[3]) px[10 - d][10 + d] = [...shade(p.slice(0, 3), white, 0.35), 255];
  }
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) px[7 + dy][7 + dx] = [255, 255, 255, 255];   // the glint
  const out = outlinePixels(px, special === null ? shade(c, black, 0.72) : shade(c, white, 0.3));
  for (const [rows, top] of [[GEM_CROWN, 1], [GEM_CUP, CELL - 1 - GEM_CUP.length]]) {
    rows.forEach((row, i) => [...row].forEach((ch, j) => {
      if (GEM_METAL[ch]) out[top + i][(CELL - row.length) / 2 + j] = [...hexToRgb(GEM_METAL[ch]), 255];
    }));
  }
  return out;
}

function kyubeyPixels() {
  const colours = { W: [246, 246, 248], R: [214, 33, 59], P: [242, 140, 177] };
  const px = Array.from({ length: CELL }, () => Array(CELL).fill([0, 0, 0, 0]));
  KYUBEY_SPRITE.forEach((row, y) => [...row].forEach((ch, x) => {
    if (colours[ch]) px[y + 1][x + 1] = [...colours[ch], 255];
  }));
  return px;
}

function pixelsToCanvas(px) {   // rows of [r, g, b, a] → a canvas
  const h = px.length, w = px[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
  px.forEach((row, y) => row.forEach((p, x) => img.data.set(p, (y * w + x) * 4)));
  ctx.putImageData(img, 0, 0);
  return canvas;
}


class Crush {
  // The game, over a pane's terminal (see Pane.openGame). Each frame is drawn on the small canvas, which the page
  // shows scaled up (image-rendering: pixelated).
  static MARGIN = 4;
  static TOP = 14;
  static BOTTOM = 12;

  constructor(pane) {
    this.pane = pane;
    this.el = el('div', 'crush');
    this.el.tabIndex = 0;
    this.canvas = el('canvas');
    this.el.append(this.canvas);
    this.board = new CrushBoard({ size: CRUSH_SIZE, kinds: CHARACTERS.length, luck: CRUSH_CHAIN_LUCK,
                                  stripes: CRUSH_LUCKY_STRIPES, fade: CRUSH_CHAIN_FADE });
    const n = this.board.n;
    this.cw = n * CELL + 2 * Crush.MARGIN;
    this.ch = Crush.TOP + n * CELL + Crush.BOTTOM;
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.cr = this.canvas.getContext('2d');
    this.sprites = new Map();   // tile id → sprite: kind, special, r, c (fractional while moving), scale, alpha, flash
    this.syncSprites();
    this.phases = []; this.phase = null;
    this.effects = []; this.particles = []; this.texts = [];
    this.score = 0; this.best = 0;
    magica.crushBest().then(best => { this.best = Math.max(this.best, best); });
    this.autoplay = CRUSH_AUTOPLAY; this.assisted = false;   // autoplay on / it has played this game (no best then)
    this.selected = null; this.press = null; this.hint = null;
    this.shownScore = 0;   // the score counter rolls up to the real score
    this.shakeAmp = 0; this.shakeT = 0; this.shakeLen = 1;
    this.freeze = 0; this.fever = 0;   // hit-stop after a big blast / rainbow frame after a big chain
    this.lastMove = this.settled = this.now = now();
    this.spriteCache = new Map();
    this.origin = [0, 0, 1];   // where the canvas is in the element, and CSS px per art pixel
    this._layoutKey = null;
    this.el.addEventListener('mousedown', e => this.onPress(e));
    this.el.addEventListener('mouseup', () => { this.press = null; });
    this.el.addEventListener('mousemove', e => this.onMotion(e));
    this.el.addEventListener('keydown', e => this.onKey(e));
    this.frame = requestAnimationFrame(() => this.onTick());
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.el.remove();
  }

  // ── state ──
  saveBest() {
    magica.saveCrushBest(this.best);
  }

  syncSprites() {   // sprites exactly as the board is (after a turn, in case an animation missed something)
    const old = this.sprites;
    this.sprites = new Map();
    for (const [r, c] of this.board.cells()) {
      const t = this.board.at([r, c]);
      const s = old.get(t.id) || { scale: 1, alpha: 1, flash: 0 };
      Object.assign(s, { kind: t.kind, special: t.special, r, c, dying: false });
      this.sprites.set(t.id, s);
    }
  }

  colour(kind) {   // her soul gem's colour, for sparks, beams and text (Kyubey: white, or red on light)
    if (kind === null) return this.pane.win.theme === 'dark' ? '#f4f4f4' : '#d6213b';
    return GEM_COLOURS[kind];
  }

  kick(amp, dur) {   // shake the board (the stronger shake wins)
    if (amp >= this.shakeAmp * this.shakeT / this.shakeLen) {
      this.shakeAmp = amp; this.shakeT = dur; this.shakeLen = dur;
    }
  }

  spriteImages(kind, special) {   // pre-drawn sprite for a soul gem (or Kyubey) and its special look, and its silhouette
    const key = `${kind},${special}`;
    if (!this.spriteCache.has(key)) {
      const px = kind === null ? outlinePixels(kyubeyPixels(), [40, 36, 48]) : gemPixels(kind, special);
      const white = px.map(row => row.map(p => p[3] ? [255, 255, 255, p[3]] : p));
      this.spriteCache.set(key, [pixelsToCanvas(px), pixelsToCanvas(white)]);
    }
    return this.spriteCache.get(key);
  }

  get busy() {
    return this.phase !== null || this.phases.length > 0;
  }

  // ── input ──
  cellAt(e) {
    const rect = this.el.getBoundingClientRect(), [ox, oy, k] = this.origin;
    const cx = (e.clientX - rect.left - ox) / k - Crush.MARGIN, cy = (e.clientY - rect.top - oy) / k - Crush.TOP;
    const r = Math.floor(cy / CELL), c = Math.floor(cx / CELL), n = this.board.n;
    return cx >= 0 && cy >= 0 && r < n && c < n ? [r, c] : null;
  }

  onPress(e) {
    e.preventDefault();
    this.el.focus();
    if (e.button !== 0 || this.busy) return;
    if (this.autoplay) this.toggleAutoplay();   // a click takes over
    const p = this.cellAt(e), s = this.selected;
    if (!p) {
      this.selected = null;
    } else if (s && Math.abs(p[0] - s[0]) + Math.abs(p[1] - s[1]) === 1) {
      this.trySwap(s, p);
    } else {
      this.selected = samePos(s, p) ? null : p;
      this.press = [p, e.clientX, e.clientY];
    }
  }

  onMotion(e) {
    if (!this.press || this.busy) return;
    const [p, x, y] = this.press, k = this.origin[2];
    const dx = (e.clientX - x) / k, dy = (e.clientY - y) / k;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= CELL / 2) {   // dragged half a cell: swap that way
      const across = Math.abs(dx) > Math.abs(dy);
      const q = [p[0] + (across ? 0 : Math.sign(dy)), p[1] + (across ? Math.sign(dx) : 0)];
      this.press = null;
      if (q[0] >= 0 && q[0] < this.board.n && q[1] >= 0 && q[1] < this.board.n) this.trySwap(p, q);
    }
  }

  onKey(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      this.pane.closeGame();
    } else if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      this.toggleAutoplay();
    }
  }

  toggleAutoplay() {
    this.autoplay = !this.autoplay;
    this.settled = this.now;
    this.text(this.autoplay ? 'AUTOPLAY ON' : 'AUTOPLAY OFF', this.cw / 2, Crush.TOP + this.board.n * CELL / 2,
              '#ffffff', 2, 0.8);
  }

  // ── turns ──
  trySwap(a, b) {
    this.selected = null; this.press = null; this.hint = null;
    this.lastMove = now();
    const ta = this.board.at(a), tb = this.board.at(b);
    const steps = this.board.swap(a, b);
    this.queue('swap', 0.16, { ids: [ta.id, tb.id], a, b });
    if (steps === null) {
      this.queue('swap', 0.16, { ids: [ta.id, tb.id], a: b, b: a });
      return;
    }
    for (const step of steps) {
      if (step.transforms.length) this.queue('transform', 0.35, { step });
      this.queue('pop', 0.3, { step });
      const longest = Math.max(0, ...step.falls.map(([, , fr, to]) => to - fr));
      this.queue('fall', 0.1 * Math.sqrt(longest) + 0.12, { step });
    }
    this.queue('settle', 0);
  }

  queue(kind, dur, data = {}) {
    this.phases.push({ kind, dur: dur / CRUSH_SPEED, ...data });
  }

  begin(ph) {
    ph.start = this.now;
    if (ph.kind === 'pop') {
      this.pop(ph.step);
    } else if (ph.kind === 'fall') {
      for (const [t, c, fr, to] of ph.step.falls) {
        let s = this.sprites.get(t.id);
        if (!s) {   // as it was when it dropped in: it may turn special later in this turn
          s = { kind: t.bornKind, special: null, scale: 1, alpha: 1, flash: 0, dying: false };
          this.sprites.set(t.id, s);
        }
        Object.assign(s, { r: fr, c, fr, to });
      }
    } else if (ph.kind === 'settle') {
      this.settled = this.now;
      this.syncSprites();
      this.saveBest();
      if (this.board.hint() === null) {   // no moves left: shuffle
        this.board.shuffle();
        const old = new Map([...this.sprites].map(([id, s]) => [id, [s.r, s.c]]));
        this.syncSprites();
        for (const [id, s] of this.sprites) {
          s.from = old.get(id) || [s.r, s.c];
          s.to = [s.r, s.c];
        }
        this.text('SHUFFLE!', this.cw / 2, Crush.TOP + this.board.n * CELL / 2, '#ffffff', 2, 1.0);
        this.phases.unshift({ kind: 'shuffle', dur: 0.45 / CRUSH_SPEED });
      }
    }
  }

  finish(ph) {
    if (ph.kind === 'swap') {
      const [ia, ib] = ph.ids;
      Object.assign(this.sprites.get(ia), { r: ph.b[0], c: ph.b[1] });
      Object.assign(this.sprites.get(ib), { r: ph.a[0], c: ph.a[1] });
    } else if (ph.kind === 'transform') {
      for (const [t] of ph.step.transforms) {
        const s = this.sprites.get(t.id);
        if (s) Object.assign(s, { special: t.special, flash: 1 });
      }
    } else if (ph.kind === 'pop') {
      for (const [t] of ph.step.clears) this.sprites.delete(t.id);
      for (const [t] of ph.step.created) {
        const s = this.sprites.get(t.id);
        if (s) Object.assign(s, { kind: t.kind, special: t.special, flash: 1 });
      }
    } else if (ph.kind === 'fall') {
      for (const [t, c, , to] of ph.step.falls) {
        const s = this.sprites.get(t.id);
        if (s) Object.assign(s, { r: to, c });
      }
    } else if (ph.kind === 'shuffle') {
      for (const s of this.sprites.values()) {
        [s.r, s.c] = s.to;
        delete s.from; delete s.to;
      }
    }
  }

  update(ph, p) {
    if (ph.kind === 'swap') {
      const e = p * p * (3 - 2 * p);
      const [[ar, ac], [br, bc]] = [ph.a, ph.b], [ia, ib] = ph.ids;
      Object.assign(this.sprites.get(ia), { r: ar + (br - ar) * e, c: ac + (bc - ac) * e });
      Object.assign(this.sprites.get(ib), { r: br + (ar - br) * e, c: bc + (ac - bc) * e });
    } else if (ph.kind === 'transform') {
      for (const [t] of ph.step.transforms) {
        const s = this.sprites.get(t.id);
        if (s) s.flash = Math.floor(p * 6) % 2 === 0 ? 1 : 0;
      }
    } else if (ph.kind === 'pop') {
      for (const [t] of ph.step.clears) {
        const s = this.sprites.get(t.id);
        if (s) Object.assign(s, { dying: true, scale: 1 + 0.45 * p, alpha: 1 - p });
      }
    } else if (ph.kind === 'fall') {
      for (const [t, , fr, to] of ph.step.falls) {
        const s = this.sprites.get(t.id);
        if (!s) continue;
        const own = (0.1 * Math.sqrt(to - fr) + 0.02) / CRUSH_SPEED;   // falls as if by gravity
        const tt = p * ph.dur;
        if (tt < own) {
          s.r = fr + (to - fr) * (tt / own) ** 2;
        } else {   // a small bounce on landing
          const b = Math.min(1, (tt - own) / Math.max(ph.dur - own, 0.01));
          s.r = to - 0.12 * Math.sin(Math.PI * b) * (1 - b);
        }
      }
    } else if (ph.kind === 'shuffle') {
      const e = p * p * (3 - 2 * p);
      for (const s of this.sprites.values()) {
        const [[fr, fc], [tr, tc]] = [s.from, s.to];
        s.r = fr + (tr - fr) * e;
        s.c = fc + (tc - fc) * e;
      }
    }
  }

  pop(step) {
    // Start of a clear: score, effects for every special that goes off, sparks for every gem, and the bigger the moment
    // (a long chain, a big clear, a bomb), the harder it shakes and the more it sparkles.
    this.score += step.score;
    if (!this.assisted) this.best = Math.max(this.best, this.score);
    const x0 = Crush.MARGIN, y0 = Crush.TOP, n = this.board.n;
    const centre = (r, c) => [x0 + c * CELL + CELL / 2, y0 + r * CELL + CELL / 2];
    const big = step.fires.some(f => ['bomb', 'board', 'blast', 'cross'].includes(f[0]));
    const power = step.combo - 1 + Math.floor(step.clears.length / 10) + 2 * big;
    for (const [special, r, c, kind] of step.fires) {
      const colour = this.colour(kind);
      if (special === 'wrapped') {   // stays on the board, armed for a second blast
        for (const s of this.sprites.values()) {
          if (!s.dying && Math.round(s.r) === r && Math.round(s.c) === c) s.special = 'armed';
        }
      }
      if (special === 'bomb') {
        const targets = step.clears.filter(([t]) => t.kind === kind).map(([, rr, cc]) => centre(rr, cc));
        this.effects.push({ kind: 'rays', at: centre(r, c), targets, colour, t: 0, life: 0.4 });
      } else if (special === 'board') {
        this.effects.push({ kind: 'flash', colour: '#ffffff', t: 0, life: 0.5 });
      } else {
        this.effects.push({ kind: special, at: [r, c], colour, t: 0, life: 0.35 });
      }
      this.kick(big ? 3 : 1, 0.3);
    }
    const sparks = 3 + Math.min(power, 6);
    for (const [t, r, c] of step.clears) {
      const [x, y] = centre(r, c);
      for (let i = 0; i < sparks; i++) {
        const a = uniform(0, 2 * Math.PI), v = uniform(25, 60 + 10 * Math.min(power, 6));
        this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, shape: 'spark',
                              life: uniform(0.35, 0.6), colour: this.colour(t.kind) });
      }
    }
    if (step.clears.length) {
      const kinds = step.clears.map(([t]) => t.kind).filter(k => k !== null);
      const counts = new Map();
      for (const k of kinds) counts.set(k, (counts.get(k) || 0) + 1);
      const kind = kinds.length ? [...counts].reduce((a, b) => b[1] > a[1] ? b : a)[0] : null;
      const xs = step.clears.map(([, r, c]) => centre(r, c));
      const x = xs.reduce((s, p) => s + p[0], 0) / xs.length, y = xs.reduce((s, p) => s + p[1], 0) / xs.length;
      this.text(`+${step.score}`, x, y, this.colour(kind), 1, 0.8, { rise: 10 });
      if (power >= 2) {   // a shockwave from the middle of the clear
        this.effects.push({ kind: 'ring', at: [x, y], reach: 24 + 8 * Math.min(power, 8), colour: this.colour(kind),
                            t: 0, life: 0.45 });
      }
    }
    if (power >= 1) this.kick(Math.min(5, 1 + Math.floor(power / 2)), 0.15 + 0.05 * Math.min(power, 8));
    if (power >= 4) this.freeze = 0.08;   // hit-stop: everything holds for a beat
    const combo = step.combo, mid = Crush.TOP + n * CELL / 2;
    const colour = this.colour(combo % CHARACTERS.length);
    if (combo === 2) {
      this.text('COMBO X2!', this.cw / 2, mid - 10, colour, 2, 0.9, { rise: 6, blink: true });
    } else if (combo >= 3) {
      const word = { 3: 'GREAT!', 4: 'AMAZING!', 5: 'MIRACLE!' }[combo] || 'TIRO FINALE!';
      this.text(word, this.cw / 2, mid - 14, colour, 2, 1.1, { rise: 6, blink: true });
      this.text(`COMBO X${combo}`, this.cw / 2, mid + 2, '#ffffff', 1, 1.1, { rise: 6 });
      this.effects.push({ kind: 'flash', colour, t: 0, life: 0.35, strength: 0.35 });
    }
    if (combo >= 4) this.fever = 1.8;
    if (combo >= 5) {   // confetti from both bottom corners
      for (const side of [0, 1]) {
        for (let i = 0; i < 24; i++) {
          const a = uniform(55, 85) * Math.PI / 180, v = uniform(110, 170);
          this.particles.push({
            x: side === 0 ? x0 : x0 + n * CELL, y: y0 + n * CELL, vx: (side === 0 ? 1 : -1) * Math.cos(a) * v,
            vy: -Math.sin(a) * v, t: 0, life: uniform(1.0, 1.5), shape: 'confetti',
            colour: GEM_COLOURS[Math.floor(Math.random() * GEM_COLOURS.length)] });
        }
      }
    }
  }

  text(s, x, y, colour, size, life, { rise = 0, blink = false } = {}) {
    this.texts.push({ s, x, y, colour, size, t: 0, life, rise, blink });
  }

  onTick() {
    if (this.destroyed) return;
    this.frame = requestAnimationFrame(() => this.onTick());
    if (!this.el.offsetParent) return;   // its tab is hidden: the game waits (like GTK's tick callback when unmapped)
    const time = now(), dt = Math.min(time - this.now, 0.05);
    this.now = time;
    if (this.freeze > 0) {   // hit-stop: the turn holds still (sparks keep flying)
      this.freeze -= dt;
      if (this.phase) this.phase.start += dt;
    }
    while (this.freeze <= 0) {
      if (this.phase === null) {
        if (!this.phases.length) break;
        this.phase = this.phases.shift();
        this.begin(this.phase);
      }
      const p = this.phase.dur > 0 ? (time - this.phase.start) / this.phase.dur : 1;
      this.update(this.phase, Math.min(p, 1));
      if (p < 1) break;
      this.finish(this.phase);
      this.phase = null;
    }
    for (const s of this.sprites.values()) s.flash = Math.max(0, s.flash - dt * 3);
    for (const e of [...this.effects, ...this.texts]) e.t += dt;
    for (const q of this.particles) {
      q.t += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += (q.shape === 'confetti' ? 90 : q.shape === 'spark' ? 160 : 0) * dt;
      if (q.shape === 'confetti') q.vx *= 1 - 1.5 * dt;   // air drag, so it flutters down
    }
    if (this.fever > 0) {   // fever: stars twinkle all over the board
      this.fever -= dt;
      if (Math.random() < 0.5) {
        const n = this.board.n;
        this.particles.push({ x: Crush.MARGIN + uniform(0, n * CELL), y: Crush.TOP + uniform(0, n * CELL),
                              vx: 0, vy: 0, t: 0, life: 0.5, shape: 'star', colour: '#ffffff' });
      }
    }
    this.shownScore += (this.score - this.shownScore) * Math.min(1, dt * 8);
    if (this.score - this.shownScore < 1) this.shownScore = this.score;
    this.effects = this.effects.filter(e => e.t < e.life);
    this.texts = this.texts.filter(e => e.t < e.life);
    this.particles = this.particles.filter(q => q.t < q.life);
    this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.autoplay && !this.busy && time - this.settled > CRUSH_AUTOPLAY_DELAY) {
      const move = this.board.bestMove();
      if (move) {
        this.assisted = true;
        this.trySwap(...move);
      }
    }
    if (!this.busy && this.hint === null && time - this.lastMove > CRUSH_HINT_AFTER) this.hint = this.board.hint();
    this.render();
  }

  // ── drawing ──
  render() {
    const theme = THEMES[this.pane.win.theme];
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w <= 1 || h <= 1) return;
    // a whole number of device pixels per art pixel keeps the pixels square (at any Windows display scale)
    const dpr = devicePixelRatio || 1;
    let k = Math.min(w * dpr / this.cw, h * dpr / this.ch);
    k = k >= 1 ? Math.floor(k) : k;
    const layout = `${w},${h},${dpr},${theme.bg}`;
    if (layout !== this._layoutKey) {   // opaque background: the terminal underneath is transparent
      this._layoutKey = layout;
      const cssW = this.cw * k / dpr, cssH = this.ch * k / dpr;
      const left = Math.round((w - cssW) / 2 * dpr) / dpr, top = Math.round((h - cssH) / 2 * dpr) / dpr;
      Object.assign(this.canvas.style, { width: `${cssW}px`, height: `${cssH}px`, left: `${left}px`, top: `${top}px` });
      this.el.style.background = theme.bg;
      this.origin = [left, top, k / dpr];
    }
    this.drawCanvas(theme);
  }

  fill(colour, x, y, w, h, alpha = 1) {
    const cr = this.cr;
    cr.globalAlpha = Math.max(0, Math.min(1, alpha));
    cr.fillStyle = colour;
    cr.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  line(colour, x0, y0, x1, y1, alpha) {   // a 1-pixel line without antialiasing (Bresenham)
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.fill(colour, x0, y0, 1, 1, alpha);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  drawText(s, x, y, colour, { size = 1, centred = false, alpha = 1, outline = null } = {}) {
    const width = s.length * 4 * size - size;
    if (centred) x -= width / 2;
    x = Math.round(x); y = Math.round(y);
    if (outline) {   // 1-pixel outline all round, so it reads over the heads
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2]]) {
        this.drawText(s, x + dx * size, y + dy * size, outline, { size, alpha });
      }
    }
    [...s.toUpperCase()].forEach((ch, i) => {
      const glyph = FONT_3X5[ch] || FONT_3X5[' '];
      [...glyph].forEach((bit, j) => {
        if (bit === '1') this.fill(colour, x + (i * 4 + j % 3) * size, y + Math.floor(j / 3) * size, size, size, alpha);
      });
    });
  }

  drawCanvas(theme) {
    const cr = this.cr;
    cr.imageSmoothingEnabled = false;
    const { bg, fg, dim } = theme;
    this.fill(bg, 0, 0, this.cw, this.ch);
    const n = this.board.n, x0 = Crush.MARGIN, y0 = Crush.TOP;
    const amp = Math.round(this.shakeAmp * this.shakeT / this.shakeLen);
    const jitter = () => Math.floor(Math.random() * (2 * amp + 1)) - amp;
    const shake = amp ? [jitter(), jitter()] : [0, 0];

    // header: score and best
    this.drawText('SCORE', x0, 3, dim);
    const rolling = this.shownScore < this.score;
    this.drawText(String(Math.floor(this.shownScore)), x0 + 24, 3,
                  rolling ? this.colour(Math.floor(this.now * 12) % CHARACTERS.length) : fg);
    const best = `BEST ${this.best}`;
    this.drawText(best, x0 + n * CELL - best.length * 4 + 1, 3, dim);

    cr.save();
    cr.translate(...shake);
    // board: a pixel frame and a checkerboard
    this.fill(dim, x0 - 2, y0 - 2, n * CELL + 4, n * CELL + 4);
    if (this.fever > 0) {   // fever: the frame runs through the five colours
      const side = n * CELL + 4, step = 6;
      for (let i = 0; i < 4 * side; i += step) {
        const colour = GEM_COLOURS[(Math.floor(i / step) + Math.floor(this.now * 20)) % GEM_COLOURS.length];
        const d = i % side;
        const [x, y, w, h] = [[x0 - 2 + d, y0 - 2, step, 2], [x0 + n * CELL, y0 - 2 + d, 2, step],
                              [x0 + n * CELL + 2 - d - step, y0 + n * CELL, step, 2],
                              [x0 - 2, y0 + n * CELL + 2 - d - step, 2, step]][Math.floor(i / side)];
        this.fill(colour, x, y, w, h);
      }
    }
    this.fill(bg, x0 - 1, y0 - 1, n * CELL + 2, n * CELL + 2);
    const light = mix(bg, fg, 0.05), dark = mix(bg, fg, 0.10);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) this.fill((r + c) % 2 === 0 ? light : dark, x0 + c * CELL, y0 + r * CELL, CELL, CELL);
    }
    const hint = this.hint || [];
    cr.save();
    cr.beginPath();
    cr.rect(x0, y0, n * CELL, n * CELL);   // heads dropping in from above appear at the top edge
    cr.clip();
    for (const s of [...this.sprites.values()].sort((a, b) => a.dying - b.dying)) {
      let x = x0 + s.c * CELL, y = y0 + s.r * CELL;
      const p = [Math.round(s.r), Math.round(s.c)];
      if (samePos(p, this.selected) && !this.busy) y -= 1 + Math.round(Math.sin(this.now * 8));   // selected: bobs
      if (hint.some(q => samePos(p, q)) && !this.busy) {   // hint: wiggles
        x += Math.floor(this.now * 2) % 2 === 0 ? Math.round(Math.sin(this.now * 18)) : 0;
      }
      this.drawSprite(s, x, y);
    }
    cr.restore();
    if (this.selected && !this.busy) {   // corner brackets in her colour
      const [r, c] = this.selected;
      const colour = this.colour(this.board.at(this.selected).kind);
      const bx = x0 + c * CELL, by = y0 + r * CELL;
      for (const [dx, dy] of [[0, 0], [CELL - 3, 0], [0, CELL - 3], [CELL - 3, CELL - 3]]) {
        this.fill(colour, bx + dx, by + dy + (dy === 0 ? 0 : 2), 3, 1);
        this.fill(colour, bx + dx + (dx === 0 ? 0 : 2), by + dy, 1, 3);
      }
    }
    this.drawEffects();
    cr.restore();

    for (const q of this.particles) {
      const a = 1 - q.t / q.life;
      if (q.shape === 'star') {   // a little plus that grows and shrinks
        const size = Math.abs(q.t / q.life - 0.5) > 0.25 ? 1 : 2;
        this.fill(q.colour, q.x - size, q.y, 2 * size + 1, 1);
        this.fill(q.colour, q.x, q.y - size, 1, 2 * size + 1);
      } else if (q.shape === 'confetti') {   // tumbles: wide, then tall
        const [w, h] = Math.floor(q.t * 10 + q.vx) % 2 ? [2, 1] : [1, 2];
        this.fill(q.colour, q.x, q.y, w, h, Math.min(1, 3 * a));
      } else {
        this.fill(q.colour, q.x, q.y, 2, 2, a);
      }
    }
    for (const e of this.texts) {
      const f = e.t / e.life;
      if (e.blink && Math.floor(e.t * 10) % 2) continue;
      this.drawText(e.s, e.x, e.y - e.rise * f, e.colour, { size: e.size, centred: true,
                    alpha: 1 - Math.max(0, f - 0.6) / 0.4, outline: '#120f18' });
    }

    // footer: title in the five colours, and how to leave
    [...'MAGICA CRUSH'].forEach((ch, i) => {
      const colour = ch !== ' ' ? this.colour((i + Math.floor(this.now * 3)) % CHARACTERS.length) : dim;
      this.drawText(ch, x0 + i * 4, this.ch - 7, colour);
    });
    this.drawText('ESC QUIT', x0 + n * CELL - 31, this.ch - 7, dim);
    this.drawText(this.autoplay ? 'AUTO' : 'A AUTO', x0 + Math.floor(n * CELL / 2) + 8, this.ch - 7,
                  this.autoplay ? fg : dim, { centred: true });
    cr.globalAlpha = 1;
  }

  drawSprite(s, x, y) {
    const [img, white] = this.spriteImages(s.kind, s.special), cr = this.cr;
    cr.save();
    cr.translate(Math.round(x + CELL / 2), Math.round(y + CELL / 2));
    if (s.scale !== 1) cr.scale(s.scale, s.scale);
    cr.globalAlpha = Math.max(0, Math.min(1, s.alpha));
    cr.drawImage(img, -CELL / 2, -CELL / 2);
    let flash = s.flash;
    if (s.special === 'armed') flash = Math.max(flash, Math.floor(this.now * 12) % 2 === 0 ? 0.6 : 0);   // about to go off again: flickers
    if (flash > 0) {   // flash: her silhouette in white
      cr.globalAlpha = Math.max(0, Math.min(1, 0.8 * flash * s.alpha));
      cr.drawImage(white, -CELL / 2, -CELL / 2);
    }
    cr.restore();
    if ((s.special === 'wrapped' || s.special === 'armed') && !s.dying) {   // wrapper: little corner pips
      const colour = this.colour(s.kind);
      for (const [dx, dy] of [[0, 0], [CELL - 2, 0], [0, CELL - 2], [CELL - 2, CELL - 2]]) {
        this.fill(colour, x + dx, y + dy, 2, 2);
      }
    }
  }

  drawEffects() {
    const x0 = Crush.MARGIN, y0 = Crush.TOP, n = this.board.n;
    for (const e of this.effects) {
      const f = e.t / e.life, a = 1 - f, kind = e.kind;
      if (kind === 'flash') {
        this.fill(e.colour, x0, y0, n * CELL, n * CELL, (e.strength ?? 0.8) * a);
        continue;
      }
      if (kind === 'ring') {   // a pixel circle growing out of the clear
        const [cx, cy] = e.at, rad = e.reach * (0.2 + 0.8 * f), dots = Math.max(12, Math.floor(rad * 2.5));
        for (let i = 0; i < dots; i++) {
          const ang = 2 * Math.PI * i / dots;
          this.fill(e.colour, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, 2, 2, a);
        }
        continue;
      }
      if (kind === 'rays') {
        const [ax, ay] = e.at, reach = Math.min(1, f * 3);
        for (const [tx, ty] of e.targets) {
          this.line(e.colour, Math.round(ax), Math.round(ay),
                    Math.round(ax + (tx - ax) * reach), Math.round(ay + (ty - ay) * reach), a);
        }
        continue;
      }
      const [r, c] = e.at;
      const cx = x0 + c * CELL + CELL / 2, cy = y0 + r * CELL + CELL / 2;
      const thick = Math.max(1, Math.round(8 * a));
      if (kind === 'h' || kind === 'cross') {
        for (const rr of kind === 'cross' ? [r - 1, r, r + 1] : [r]) {
          this.fill('#ffffff', x0, y0 + rr * CELL + CELL / 2 - thick / 2, n * CELL, thick, a);
          this.fill(e.colour, x0, y0 + rr * CELL + CELL / 2 - thick / 4, n * CELL, Math.max(1, thick / 2), a);
        }
      }
      if (kind === 'v' || kind === 'cross') {
        for (const cc of kind === 'cross' ? [c - 1, c, c + 1] : [c]) {
          this.fill('#ffffff', x0 + cc * CELL + CELL / 2 - thick / 2, y0, thick, n * CELL, a);
          this.fill(e.colour, x0 + cc * CELL + CELL / 2 - thick / 4, y0, Math.max(1, thick / 2), n * CELL, a);
        }
      }
      if (kind === 'wrapped' || kind === 'armed' || kind === 'blast') {   // a square ring growing out of her cell
        const reach = (kind !== 'blast' ? 1.5 : 2.5) * CELL * (0.3 + 0.7 * f);
        for (const [colour, inset] of [['#ffffff', 0], [e.colour, 2]]) {
          const rr = reach - inset;
          for (const [x, y, ww, hh] of [[cx - rr, cy - rr, 2 * rr, 2], [cx - rr, cy + rr - 2, 2 * rr, 2],
                                        [cx - rr, cy - rr, 2, 2 * rr], [cx + rr - 2, cy - rr, 2, 2 * rr]]) {
            this.fill(colour, x, y, ww, hh, a);
          }
        }
      }
    }
  }
}


if (typeof module === 'object' && module.exports) module.exports = { Rng, Tile, Step, CrushBoard };
