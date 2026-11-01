// Rules of the `crush` game (CrushBoard in ../crush.js), the same tests as ../../tests/test_crush.py. Run: npm test
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Rng, Tile, CrushBoard } = require('../crush.js');

const X = 5;   // a character the base pattern never uses, so test pieces only match each other
const GAME = { luck: 0.4, stripes: 0.05, fade: 0.72 };   // the game's chain luck (CRUSH_* in renderer.js)
const k = (r, c) => `${r},${c}`;

function board(edits = [], seed = 1, check = true) {
  // An 8x8 board with no matches ((2r + c) mod 5), then `edits`: [[[r, c], kind or [kind, special]]]
  const b = new CrushBoard({ kinds: 6, rng: new Rng(seed), ...GAME });
  b.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => new Tile((2 * r + c) % 5)));
  for (const [[r, c], v] of edits) b.grid[r][c] = Array.isArray(v) ? new Tile(...v) : new Tile(v);
  assert.ok(!check || !b.runs().length, 'test board already has a match');
  return b;
}

const cleared = step => new Set(step.clears.map(([, r, c]) => k(r, c)));
const includesAll = (set, cells) => cells.every(([r, c]) => set.has(k(r, c)));
const row = r => Array.from({ length: 8 }, (_, c) => [r, c]);
const col = c => Array.from({ length: 8 }, (_, r) => [r, c]);
const ids = b => b.grid.map(rw => rw.map(t => t.id));

// ── matching ──
test('fresh boards have no matches and a move', () => {
  for (let seed = 0; seed < 50; seed++) {
    const b = new CrushBoard({ rng: new Rng(seed) });
    assert.deepEqual(b.runs(), []);
    assert.notEqual(b.hint(), null);
  }
});

test('a swap without a match is undone', () => {
  const b = board(), before = ids(b);
  assert.equal(b.swap([0, 0], [0, 1]), null);
  assert.deepEqual(ids(b), before);
});

test('not neighbours', () => {
  assert.equal(board().swap([0, 0], [0, 2]), null);
});

test('three in a row', () => {
  const b = board([[[0, 0], X], [[0, 1], X], [[1, 2], X]]);
  const steps = b.swap([1, 2], [0, 2]);
  assert.ok(steps.length);
  assert.deepEqual(cleared(steps[0]), new Set([k(0, 0), k(0, 1), k(0, 2)]));
  assert.equal(steps[0].score, 60);
  assert.deepEqual(steps[0].created, []);
});

test('the board is full after a turn', () => {
  const b = board([[[0, 0], X], [[0, 1], X], [[1, 2], X]]);
  b.swap([1, 2], [0, 2]);
  assert.ok(b.grid.flat().every(t => t !== null));
  assert.deepEqual(b.runs(), []);   // cascades ran until nothing matched
});

test('the hint is a move', () => {
  const b = board([[[0, 0], X], [[0, 1], X], [[1, 2], X]]);
  const hint = b.hint();
  assert.ok([...b.moves()].some(([p, q]) => JSON.stringify([p, q]) === JSON.stringify(hint)));
});

test('autoplay picks the bigger match', () => {
  const b = board([[[0, 0], X], [[0, 1], X], [[1, 2], X],                  // (1, 2) up: 3 in a row
                   [[5, 0], X], [[5, 1], X], [[5, 3], X], [[6, 2], X]]);   // (6, 2) up: 4 in a row
  assert.deepEqual(b.bestMove(), [[5, 2], [6, 2]]);
});

test('autoplay sets off a bomb first', () => {
  const b = board([[[5, 0], X], [[5, 1], X], [[5, 3], X], [[6, 2], X], [[2, 3], [0, 'bomb']]]);
  assert.ok(b.bestMove().some(p => p[0] === 2 && p[1] === 3));
});

test('autoplay has no move on a stuck board', () => {
  const b = board();
  b.grid = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => new Tile((r + c) % 2 * 5 + (r + c) % 3)));
  assert.deepEqual([...b.moves()], []);
  assert.equal(b.bestMove(), null);
});

// ── specials ──
test('4 makes a striped head where you moved', () => {
  const b = board([[[3, 0], X], [[3, 1], X], [[3, 3], X], [[4, 2], X]]);
  const steps = b.swap([4, 2], [3, 2]);
  const [t, r, c] = steps[0].created[0];
  assert.deepEqual([t.special, t.kind, r, c], ['v', X, 3, 2]);   // a horizontal 4 → clears a column
  assert.deepEqual(cleared(steps[0]), new Set([k(3, 0), k(3, 1), k(3, 3)]));
  assert.equal(steps[0].score, 120);
});

test('5 makes a bomb', () => {
  const b = board([[[5, 0], X], [[5, 1], X], [[5, 3], X], [[5, 4], X], [[6, 2], X]]);
  const steps = b.swap([6, 2], [5, 2]);
  const [t, r, c] = steps[0].created[0];
  assert.deepEqual([t.special, t.kind, r, c], ['bomb', null, 5, 2]);
  assert.deepEqual(cleared(steps[0]), new Set([k(5, 0), k(5, 1), k(5, 3), k(5, 4)]));
  assert.equal(steps[0].score, 200);
});

test('long runs clear whole and score more', () => {
  // a swap fills one gap, so runs longer than 5 come from cascades: resolve one directly
  const b = board([0, 1, 2, 3, 4, 5, 6].map(c => [[5, c], X]), 1, false);
  const steps = b.resolve();
  assert.equal(steps[0].score, 7 * 6 * 10);   // 3 → 60, 4 → 120, 5 → 200, 6 → 300, 7 → 420
  assert.equal(steps[0].created[0][0].special, 'bomb');
  assert.equal(cleared(steps[0]).size, 6);   // the 7th became the bomb
});

test('an L shape makes a wrapped head', () => {
  const b = board([[[2, 0], X], [[2, 1], X], [[0, 2], X], [[1, 2], X], [[3, 2], X]]);
  const steps = b.swap([3, 2], [2, 2]);
  const [t, r, c] = steps[0].created[0];
  assert.deepEqual([t.special, r, c], ['wrapped', 2, 2]);
});

test('striped clears its row and sets off another', () => {
  // a striped "h" head in a 3-match on row 4 clears row 4, which hits a striped "v" head at (4, 7) → column 7
  const b = board([[[4, 0], [X, 'h']], [[4, 1], X], [[5, 2], X], [[4, 7], [0, 'v']]]);
  const steps = b.swap([5, 2], [4, 2]);
  const hit = cleared(steps[0]);
  assert.ok(includesAll(hit, row(4)));
  assert.ok(includesAll(hit, col(7)));
  assert.deepEqual(steps[0].fires.map(f => f[0]), ['h', 'v']);
});

test('wrapped goes off twice', () => {
  const b = board([[[4, 3], [X, 'wrapped']], [[4, 4], X], [[5, 5], X]]);
  const steps = b.swap([5, 5], [4, 5]);
  const first = cleared(steps[0]);
  assert.ok(!first.has(k(4, 3)));   // still there, armed
  assert.ok(includesAll(first, [[3, 2], [5, 4], [5, 2]]));
  assert.ok(steps.slice(1).some(s => s.fires.some(f => f[0] === 'armed')), 'the armed head went off again after the fall');
  assert.ok(!b.grid.flat().some(t => t.special === 'armed'));
});

test('a bomb with a head clears that character', () => {
  const b = board([[[0, 0], [null, 'bomb']]]);
  const kind = b.at([0, 1]).kind;
  const targets = b.cells().filter(p => b.at(p).kind === kind);
  const steps = b.swap([0, 0], [0, 1]);
  assert.ok(includesAll(cleared(steps[0]), targets));
  assert.equal(steps[0].fires[0][0], 'bomb');
});

test('a bomb with striped turns them all striped', () => {
  const b = board([[[0, 0], [null, 'bomb']], [[0, 1], [1, 'h']]]);
  const steps = b.swap([0, 0], [0, 1]);
  assert.ok(steps[0].transforms.length);
  assert.ok(steps[0].transforms.every(([t]) => t.special === 'h' || t.special === 'v'));
});

test('two bombs clear the board', () => {
  const b = board([[[0, 0], [null, 'bomb']], [[0, 1], [null, 'bomb']]]);
  const steps = b.swap([0, 0], [0, 1]);
  assert.equal(cleared(steps[0]).size, 64);
});

test('two striped clear a row and a column', () => {
  const b = board([[[3, 3], [0, 'h']], [[3, 4], [1, 'h']]]);
  const steps = b.swap([3, 3], [3, 4]);
  const hit = cleared(steps[0]);
  assert.ok(includesAll(hit, row(3)));
  assert.ok([3, 4].some(c => includesAll(hit, col(c))));
});

test('wrapped and wrapped is a 5x5 blast', () => {
  const b = board([[[3, 3], [0, 'wrapped']], [[3, 4], [1, 'wrapped']]]);
  const steps = b.swap([3, 3], [3, 4]);
  const blast = [];
  for (let r = 1; r < 6; r++) for (let c = 2; c < 7; c++) blast.push([r, c]);
  assert.ok(includesAll(cleared(steps[0]), blast));
});

// ── turns ──
test('falls move heads down and drop new ones', () => {
  const b = board([[[0, 0], X], [[0, 1], X], [[1, 2], X]]);
  const above = b.at([1, 0]);   // row 0 is the top: nothing falls, new heads drop into row 0
  const steps = b.swap([1, 2], [0, 2]);
  const drops = steps[0].falls.filter(([, , fr]) => fr < 0).map(([, c, fr, to]) => [c, fr, to]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(drops, [[0, -1, 0], [1, -1, 0], [2, -1, 0]]);
  assert.equal(b.at([1, 0]), above);
});

test('cascades multiply', () => {
  for (let seed = 0; seed < 200; seed++) {   // find a refill that cascades
    const b = board([[[0, 0], X], [[0, 1], X], [[1, 2], X]], seed);
    const steps = b.swap([1, 2], [0, 2]);
    if (steps.length > 1) {
      assert.deepEqual(steps.map(s => s.combo), steps.map((_, i) => i + 1));
      assert.equal(steps[1].score % 2, 0);
      return;
    }
  }
  assert.fail('no cascade in 200 seeds');
});

test('chain luck makes longer chains that still end', () => {
  const chains = (luck, stripes) => {
    const lens = [];
    for (let seed = 0; seed < 20; seed++) {
      const b = new CrushBoard({ rng: new Rng(seed), luck, stripes, fade: 0.72 });
      for (let i = 0; i < 30; i++) {
        const move = b.hint();
        if (move === null) { b.shuffle(); continue; }
        lens.push(b.swap(...move).length);
      }
    }
    return [lens.reduce((a, b) => a + b, 0) / lens.length, Math.max(...lens)];
  };
  const plain = chains(0, 0), lucky = chains(0.4, 0.05);
  assert.ok(lucky[0] > plain[0] * 1.3, `lucky ${lucky[0]} vs plain ${plain[0]}`);
  assert.ok(lucky[1] < 30);
});

test('no luck outside a chain', () => {
  const b = board();
  for (let c = 0; c < 8; c++) b.grid[0][c] = null;
  b.luck = b.stripes = 1;
  b.gravity();   // combo 0: an ordinary refill
  assert.ok(!row(0).some(p => b.at(p).special));
});

test('shuffle leaves a move and no matches', () => {
  const b = board();
  const before = b.grid.flat().map(t => t.id).sort((x, y) => x - y);
  b.shuffle();
  assert.deepEqual(b.grid.flat().map(t => t.id).sort((x, y) => x - y), before);
  assert.deepEqual(b.runs(), []);
  assert.notEqual(b.hint(), null);
});

test('random games stay consistent', () => {
  // lots of random moves (specials included): the board always ends full, settled and with no armed heads
  for (let seed = 0; seed < 30; seed++) {
    const rng = new Rng(seed);
    const b = new CrushBoard({ rng: new Rng(seed), ...GAME });
    for (let i = 0; i < 60; i++) {
      const cells = b.cells();
      rng.shuffle(cells);
      for (const p of cells.slice(0, 3)) b.at(p).special = rng.choice(['h', 'v', 'wrapped', null, null]);   // so their combos get played too
      if (b.runs().length) b.resolve();
      const move = b.hint();
      if (move === null) { b.shuffle(); continue; }
      const steps = b.swap(...move);
      assert.ok(steps && steps.length);
      assert.ok(b.grid.flat().every(t => t !== null));
      assert.deepEqual(b.runs(), []);
      assert.ok(!b.grid.flat().some(t => t.special === 'armed'));
      for (const step of steps) assert.ok(step.clears.length || step.created.length);
    }
  }
});
