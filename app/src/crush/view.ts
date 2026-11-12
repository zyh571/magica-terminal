// Magica Crush over a pane: drawn on a small canvas of "art pixels" and scaled up by a whole number with
// nearest-neighbour filtering, so everything snaps to chunky pixels. Ported from the old app's Crush widget.
import { readText, writeText } from "../ipc";
import type { Overlay, PaneHost } from "../overlay";
import { mix, THEMES } from "../theme";
import { CrushBoard, Pos, Step, Tile } from "./board";
import { CELL, FONT_3X5, GEM_COLOURS, gemPixels, kyubeyPixels, outline, spriteCanvas } from "./sprites";

const MARGIN = 4, TOP = 14, BOTTOM = 12;
const KINDS = GEM_COLOURS.length;

interface Sprite {
  kind: number | null;
  special: string | null;
  r: number;
  c: number;
  scale: number;
  alpha: number;
  flash: number;
  dying: boolean;
  from?: [number, number];
  to?: [number, number];
}

type Phase =
  | { kind: "swap"; dur: number; start?: number; ids: [number, number]; a: Pos; b: Pos }
  | { kind: "transform" | "pop" | "fall"; dur: number; start?: number; step: Step }
  | { kind: "settle" | "shuffle"; dur: number; start?: number };

interface Effect { kind: string; t: number; life: number; colour: string; at?: [number, number]; targets?: [number, number][]; reach?: number; strength?: number }
interface Particle { x: number; y: number; vx: number; vy: number; t: number; life: number; shape: "spark" | "confetti" | "star"; colour: string }
interface Text { s: string; x: number; y: number; colour: string; size: number; t: number; life: number; rise: number; blink: boolean }

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function openCrush(host: PaneHost): Overlay {
  const s = host.settings;
  const speed = s.crush_speed > 0 ? s.crush_speed : 1;
  const board = new CrushBoard({ size: Math.max(4, Math.min(16, Math.round(s.crush_size))), kinds: KINDS,
    luck: s.crush_chain_luck, stripes: s.crush_lucky_stripes, fade: s.crush_chain_fade });
  const n = board.n;
  const cw = n * CELL + 2 * MARGIN, ch = TOP + n * CELL + BOTTOM;

  const el = document.createElement("div");
  el.className = "overlay crush";
  el.tabIndex = 0;
  const view = document.createElement("canvas");
  el.append(view);
  const art = document.createElement("canvas");
  art.width = cw;
  art.height = ch;
  const g = art.getContext("2d")!;
  const vctx = view.getContext("2d")!;

  let sprites = new Map<number, Sprite>();
  const cache = new Map<string, HTMLCanvasElement>();
  let phases: Phase[] = [];
  let phase: Phase | null = null;
  let effects: Effect[] = [], particles: Particle[] = [], texts: Text[] = [];
  let score = 0, best = 0, shownScore = 0;
  let autoplay = s.crush_autoplay, assisted = false;
  let selected: Pos | null = null, press: { p: Pos; x: number; y: number } | null = null, hint: [Pos, Pos] | null = null;
  let shakeAmp = 0, shakeT = 0, shakeLen = 1, freeze = 0, fever = 0;
  let now = performance.now() / 1000, lastMove = now, settled = now;
  let origin = { x: 0, y: 0, k: 1 };
  let raf = 0, alive = true;

  readText("crush.json").then((t) => {
    try {
      const b = Number(JSON.parse(t).best);
      if (Number.isFinite(b) && b > best) best = Math.floor(b);
    } catch { /* no best yet, or a garbled file: start from 0 */ }
  }).catch(() => {});
  const saveBest = () => writeText("crush.json", JSON.stringify({ best })).catch(() => {});

  const theme = () => THEMES[host.theme()];
  const colour = (kind: number | null) => (kind === null ? (host.theme() === "dark" ? "#f4f4f4" : "#d6213b") : GEM_COLOURS[kind]);
  const busy = () => phase !== null || phases.length > 0;

  function syncSprites() {
    const old = sprites;
    sprites = new Map();
    for (const [r, c] of board.cells()) {
      const t = board.at([r, c])!;
      const sp = old.get(t.id) ?? { scale: 1, alpha: 1, flash: 0 } as Sprite;
      Object.assign(sp, { kind: t.kind, special: t.special, r, c, dying: false });
      sprites.set(t.id, sp);
    }
  }
  syncSprites();

  function kick(amp: number, dur: number) {
    if (amp >= (shakeAmp * shakeT) / shakeLen) [shakeAmp, shakeT, shakeLen] = [amp, dur, dur];
  }

  function sprite(kind: number | null, special: string | null): HTMLCanvasElement {
    const key = `${kind}:${special}`;
    if (!cache.has(key)) cache.set(key, spriteCanvas(kind === null ? outline(kyubeyPixels(), [40, 36, 48]) : gemPixels(kind, special)));
    return cache.get(key)!;
  }

  function text(str: string, x: number, y: number, col: string, size: number, life: number, rise = 0, blink = false) {
    texts.push({ s: str, x, y, colour: col, size, t: 0, life, rise, blink });
  }

  // ── input ──
  function cellAt(x: number, y: number): Pos | null {
    const cx = (x - origin.x) / origin.k - MARGIN, cy = (y - origin.y) / origin.k - TOP;
    const r = Math.floor(cy / CELL), c = Math.floor(cx / CELL);
    return cx >= 0 && cy >= 0 && r < n && c < n ? [r, c] : null;
  }

  function toggleAutoplay() {
    autoplay = !autoplay;
    settled = now;
    text(autoplay ? "AUTOPLAY ON" : "AUTOPLAY OFF", cw / 2, TOP + (n * CELL) / 2, "#ffffff", 2, 0.8);
  }

  view.addEventListener("pointerdown", (e) => {
    el.focus();
    if (e.button !== 0 || busy()) return;
    if (autoplay) toggleAutoplay();   // a click takes over
    const r = view.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const p = cellAt(x, y);
    if (!p) selected = null;
    else if (selected && Math.abs(p[0] - selected[0]) + Math.abs(p[1] - selected[1]) === 1) trySwap(selected, p);
    else {
      selected = selected && selected[0] === p[0] && selected[1] === p[1] ? null : p;
      press = { p, x, y };
    }
  });
  view.addEventListener("pointerup", () => (press = null));
  view.addEventListener("pointermove", (e) => {
    if (!press || busy()) return;
    const r = view.getBoundingClientRect();
    const dx = (e.clientX - r.left - press.x) / origin.k, dy = (e.clientY - r.top - press.y) / origin.k;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= CELL / 2) {   // dragged half a cell: swap that way
      const p = press.p;
      const q: Pos = Math.abs(dx) > Math.abs(dy) ? [p[0], p[1] + (dx > 0 ? 1 : -1)] : [p[0] + (dy > 0 ? 1 : -1), p[1]];
      press = null;
      if (q[0] >= 0 && q[0] < n && q[1] >= 0 && q[1] < n) trySwap(p, q);
    }
  });
  el.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" || e.key === "q" || e.key === "Q") host.closeOverlay();
    else if (e.key === "a" || e.key === "A") toggleAutoplay();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // ── turns ──
  function queue(p: Phase) {
    p.dur /= speed;
    phases.push(p);
  }

  function trySwap(a: Pos, b: Pos) {
    selected = press = hint = null;
    lastMove = now;
    const ta = board.at(a)!, tb = board.at(b)!;
    const steps = board.swap(a, b);
    queue({ kind: "swap", dur: 0.16, ids: [ta.id, tb.id], a, b });
    if (!steps) {
      queue({ kind: "swap", dur: 0.16, ids: [ta.id, tb.id], a: b, b: a });
      return;
    }
    for (const step of steps) {
      if (step.transforms.length) queue({ kind: "transform", dur: 0.35, step });
      queue({ kind: "pop", dur: 0.3, step });
      const longest = Math.max(0, ...step.falls.map(([, , fr, to]) => to - fr));
      queue({ kind: "fall", dur: 0.1 * Math.sqrt(longest) + 0.12, step });
    }
    queue({ kind: "settle", dur: 0 });
  }

  function begin(ph: Phase) {
    ph.start = now;
    if (ph.kind === "pop") pop(ph.step);
    else if (ph.kind === "fall") {
      for (const [t, c, fr] of ph.step.falls) {
        let sp = sprites.get(t.id);
        if (!sp) {   // as it was when it dropped in: it may turn special later in this turn
          sp = { kind: t.bornKind, special: null, scale: 1, alpha: 1, flash: 0, dying: false, r: fr, c };
          sprites.set(t.id, sp);
        }
        sp.r = fr;
        sp.c = c;
      }
    } else if (ph.kind === "settle") {
      settled = now;
      syncSprites();
      saveBest();
      if (!board.hint()) {   // no moves left: shuffle
        board.shuffle();
        const old = new Map([...sprites].map(([i, sp]) => [i, [sp.r, sp.c] as [number, number]]));
        syncSprites();
        for (const [i, sp] of sprites) {
          sp.from = old.get(i) ?? [sp.r, sp.c];
          sp.to = [sp.r, sp.c];
        }
        text("SHUFFLE!", cw / 2, TOP + (n * CELL) / 2, "#ffffff", 2, 1.0);
        phases.unshift({ kind: "shuffle", dur: 0.45 / speed });
      }
    }
  }

  function finish(ph: Phase) {
    if (ph.kind === "swap") {
      const [ia, ib] = ph.ids;
      Object.assign(sprites.get(ia)!, { r: ph.b[0], c: ph.b[1] });
      Object.assign(sprites.get(ib)!, { r: ph.a[0], c: ph.a[1] });
    } else if (ph.kind === "transform") {
      for (const [t] of ph.step.transforms) {
        const sp = sprites.get(t.id);
        if (sp) Object.assign(sp, { special: t.special, flash: 1 });
      }
    } else if (ph.kind === "pop") {
      for (const [t] of ph.step.clears) sprites.delete(t.id);
      for (const [t] of ph.step.created) {
        const sp = sprites.get(t.id);
        if (sp) Object.assign(sp, { kind: t.kind, special: t.special, flash: 1 });
      }
    } else if (ph.kind === "fall") {
      for (const [t, c, , to] of ph.step.falls) {
        const sp = sprites.get(t.id);
        if (sp) Object.assign(sp, { r: to, c });
      }
    } else if (ph.kind === "shuffle") {
      for (const sp of sprites.values()) {
        [sp.r, sp.c] = sp.to!;
        delete sp.from;
        delete sp.to;
      }
    }
  }

  function update(ph: Phase, p: number) {
    if (ph.kind === "swap") {
      const e = p * p * (3 - 2 * p);
      const [[ar, ac], [br, bc]] = [ph.a, ph.b];
      const [ia, ib] = ph.ids;
      Object.assign(sprites.get(ia)!, { r: ar + (br - ar) * e, c: ac + (bc - ac) * e });
      Object.assign(sprites.get(ib)!, { r: br + (ar - br) * e, c: bc + (ac - bc) * e });
    } else if (ph.kind === "transform") {
      for (const [t] of ph.step.transforms) {
        const sp = sprites.get(t.id);
        if (sp) sp.flash = Math.floor(p * 6) % 2 === 0 ? 1 : 0;
      }
    } else if (ph.kind === "pop") {
      for (const [t] of ph.step.clears) {
        const sp = sprites.get(t.id);
        if (sp) Object.assign(sp, { dying: true, scale: 1 + 0.45 * p, alpha: 1 - p });
      }
    } else if (ph.kind === "fall") {
      for (const [t, , fr, to] of ph.step.falls) {
        const sp = sprites.get(t.id);
        if (!sp) continue;
        const own = (0.1 * Math.sqrt(to - fr) + 0.02) / speed;   // falls as if by gravity
        const tt = p * ph.dur;
        if (tt < own) sp.r = fr + (to - fr) * (tt / own) ** 2;
        else {   // a small bounce on landing
          const b = Math.min(1, (tt - own) / Math.max(ph.dur - own, 0.01));
          sp.r = to - 0.12 * Math.sin(Math.PI * b) * (1 - b);
        }
      }
    } else if (ph.kind === "shuffle") {
      const e = p * p * (3 - 2 * p);
      for (const sp of sprites.values()) {
        const [fr, fc] = sp.from!, [tr, tc] = sp.to!;
        sp.r = fr + (tr - fr) * e;
        sp.c = fc + (tc - fc) * e;
      }
    }
  }

  /** Start of a clear: score, effects for every special that goes off, sparks for every gem; the bigger the moment
   * (a long chain, a big clear, a bomb), the harder it shakes and the more it sparkles. */
  function pop(step: Step) {
    score += step.score;
    if (!assisted) best = Math.max(best, score);
    const centre = (r: number, c: number): [number, number] => [MARGIN + c * CELL + CELL / 2, TOP + r * CELL + CELL / 2];
    const big = step.fires.some((f) => ["bomb", "board", "blast", "cross"].includes(f[0]));
    const power = step.combo - 1 + Math.floor(step.clears.length / 10) + 2 * Number(big);
    for (const [special, r, c, kind] of step.fires) {
      const col = colour(kind);
      if (special === "wrapped") {   // stays on the board, armed for a second blast
        for (const sp of sprites.values()) if (!sp.dying && Math.round(sp.r) === r && Math.round(sp.c) === c) sp.special = "armed";
      }
      if (special === "bomb") {
        const targets = step.clears.filter(([t]) => t.kind === kind).map(([, rr, cc]) => centre(rr, cc));
        effects.push({ kind: "rays", at: centre(r, c), targets, colour: col, t: 0, life: 0.4 });
      } else if (special === "board") effects.push({ kind: "flash", colour: "#ffffff", t: 0, life: 0.5 });
      else effects.push({ kind: special, at: [r, c], colour: col, t: 0, life: 0.35 });
      kick(big ? 3 : 1, 0.3);
    }
    const sparks = 3 + Math.min(power, 6);
    for (const [t, r, c] of step.clears) {
      const [x, y] = centre(r, c);
      for (let i = 0; i < sparks; i++) {
        const a = rand(0, 2 * Math.PI), v = rand(25, 60 + 10 * Math.min(power, 6));
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, t: 0, shape: "spark", life: rand(0.35, 0.6), colour: colour(t.kind) });
      }
    }
    if (step.clears.length) {
      const kinds = step.clears.map(([t]) => t.kind).filter((k): k is number => k !== null);
      const counts = new Map<number, number>();
      kinds.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
      const kind = kinds.length ? [...counts].sort((a, b) => b[1] - a[1])[0][0] : null;
      const xs = step.clears.map(([, r, c]) => centre(r, c));
      const x = xs.reduce((a, p) => a + p[0], 0) / xs.length, y = xs.reduce((a, p) => a + p[1], 0) / xs.length;
      text(`+${step.score}`, x, y, colour(kind), 1, 0.8, 10);
      if (power >= 2) effects.push({ kind: "ring", at: [x, y], reach: 24 + 8 * Math.min(power, 8), colour: colour(kind), t: 0, life: 0.45 });
    }
    if (power >= 1) kick(Math.min(5, 1 + Math.floor(power / 2)), 0.15 + 0.05 * Math.min(power, 8));
    if (power >= 4) freeze = 0.08;   // hit-stop: everything holds for a beat
    const combo = step.combo, mid = TOP + (n * CELL) / 2;
    const col = colour(combo % KINDS);
    if (combo === 2) text("COMBO X2!", cw / 2, mid - 10, col, 2, 0.9, 6, true);
    else if (combo >= 3) {
      const word = ({ 3: "GREAT!", 4: "AMAZING!", 5: "MIRACLE!" } as Record<number, string>)[combo] ?? "TIRO FINALE!";
      text(word, cw / 2, mid - 14, col, 2, 1.1, 6, true);
      text(`COMBO X${combo}`, cw / 2, mid + 2, "#ffffff", 1, 1.1, 6);
      effects.push({ kind: "flash", colour: col, t: 0, life: 0.35, strength: 0.35 });
    }
    if (combo >= 4) fever = 1.8;
    if (combo >= 5) {   // confetti from both bottom corners
      for (const side of [0, 1]) {
        for (let i = 0; i < 24; i++) {
          const a = (rand(55, 85) * Math.PI) / 180, v = rand(110, 170);
          particles.push({ x: side === 0 ? MARGIN : MARGIN + n * CELL, y: TOP + n * CELL, vx: (side === 0 ? 1 : -1) * Math.cos(a) * v,
            vy: -Math.sin(a) * v, t: 0, life: rand(1.0, 1.5), shape: "confetti", colour: GEM_COLOURS[Math.floor(Math.random() * KINDS)] });
        }
      }
    }
  }

  function tick() {
    if (!alive) return;
    const t = performance.now() / 1000;
    const dt = Math.min(t - now, 0.05);
    now = t;
    if (freeze > 0) {   // hit-stop: the turn holds still (sparks keep flying)
      freeze -= dt;
      if (phase) phase.start! += dt;
    }
    while (freeze <= 0) {
      if (!phase) {
        if (!phases.length) break;
        phase = phases.shift()!;
        begin(phase);
      }
      const p = phase.dur > 0 ? (now - phase.start!) / phase.dur : 1;
      update(phase, Math.min(p, 1));
      if (p < 1) break;
      finish(phase);
      phase = null;
    }
    for (const sp of sprites.values()) sp.flash = Math.max(0, sp.flash - dt * 3);
    for (const e of [...effects, ...texts]) e.t += dt;
    for (const q of particles) {
      q.t += dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += (q.shape === "confetti" ? 90 : q.shape === "spark" ? 160 : 0) * dt;
      if (q.shape === "confetti") q.vx *= 1 - 1.5 * dt;   // air drag, so it flutters down
    }
    if (fever > 0) {   // fever: stars twinkle all over the board
      fever -= dt;
      if (Math.random() < 0.5) particles.push({ x: MARGIN + rand(0, n * CELL), y: TOP + rand(0, n * CELL), vx: 0, vy: 0, t: 0, life: 0.5, shape: "star", colour: "#ffffff" });
    }
    shownScore += (score - shownScore) * Math.min(1, dt * 8);
    if (score - shownScore < 1) shownScore = score;
    effects = effects.filter((e) => e.t < e.life);
    texts = texts.filter((e) => e.t < e.life);
    particles = particles.filter((q) => q.t < q.life);
    shakeT = Math.max(0, shakeT - dt);
    if (autoplay && !busy() && now - settled > s.crush_autoplay_delay) {
      const move = board.bestMove();
      if (move) {
        assisted = true;
        trySwap(...move);
      }
    }
    if (!busy() && hint === null && now - lastMove > s.crush_hint_after) hint = board.hint();
    render();
    raf = requestAnimationFrame(tick);
  }

  // ── drawing ──
  function fill(col: string, x: number, y: number, w: number, h: number, alpha = 1) {
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    g.globalAlpha = 1;
  }

  function drawText(str: string, x: number, y: number, col: string, size = 1, centred = false, alpha = 1, outlineCol?: string) {
    const width = str.length * 4 * size - size;
    if (centred) x -= width / 2;
    x = Math.round(x);
    y = Math.round(y);
    if (outlineCol) {   // 1-pixel outline all round, so it reads over the heads
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 2]]) {
        drawText(str, x + dx * size, y + dy * size, outlineCol, size, false, alpha);
      }
    }
    [...str.toUpperCase()].forEach((chr, i) => {
      const glyph = FONT_3X5[chr] ?? FONT_3X5[" "];
      [...glyph].forEach((bit, j) => {
        if (bit === "1") fill(col, x + (i * 4 + (j % 3)) * size, y + Math.floor(j / 3) * size, size, size, alpha);
      });
    });
  }

  function drawSprite(sp: Sprite, x: number, y: number) {
    const img = sprite(sp.kind, sp.special);
    g.save();
    g.translate(Math.round(x + CELL / 2), Math.round(y + CELL / 2));
    if (sp.scale !== 1) g.scale(sp.scale, sp.scale);
    g.globalAlpha = sp.alpha;
    g.drawImage(img, -CELL / 2, -CELL / 2);
    let flash = sp.flash;
    if (sp.special === "armed") flash = Math.max(flash, Math.floor(now * 12) % 2 === 0 ? 0.6 : 0);   // about to go off again
    if (flash > 0) {   // flash: her silhouette in white
      const key = `white:${sp.kind}:${sp.special}`;
      if (!cache.has(key)) {
        const w = document.createElement("canvas");
        w.width = w.height = CELL;
        const wg = w.getContext("2d")!;
        wg.drawImage(img, 0, 0);
        wg.globalCompositeOperation = "source-in";
        wg.fillStyle = "#ffffff";
        wg.fillRect(0, 0, CELL, CELL);
        cache.set(key, w);
      }
      g.globalAlpha = 0.8 * flash * sp.alpha;
      g.drawImage(cache.get(key)!, -CELL / 2, -CELL / 2);
    }
    g.restore();
    if ((sp.special === "wrapped" || sp.special === "armed") && !sp.dying) {   // wrapper: little corner pips
      for (const [dx, dy] of [[0, 0], [CELL - 2, 0], [0, CELL - 2], [CELL - 2, CELL - 2]]) fill(colour(sp.kind), x + dx, y + dy, 2, 2);
    }
  }

  function drawEffects() {
    const x0 = MARGIN, y0 = TOP;
    for (const e of effects) {
      const f = e.t / e.life, a = 1 - f;
      if (e.kind === "flash") {
        fill(e.colour, x0, y0, n * CELL, n * CELL, (e.strength ?? 0.8) * a);
        continue;
      }
      if (e.kind === "ring") {   // a pixel circle growing out of the clear
        const [cx, cy] = e.at!, rad = e.reach! * (0.2 + 0.8 * f);
        const count = Math.max(12, Math.floor(rad * 2.5));
        for (let i = 0; i < count; i++) {
          const ang = (2 * Math.PI * i) / count;
          fill(e.colour, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, 2, 2, a);
        }
        continue;
      }
      if (e.kind === "rays") {
        const [ax, ay] = e.at!;
        g.globalAlpha = a;
        g.strokeStyle = e.colour;
        g.lineWidth = 1;
        for (const [tx, ty] of e.targets!) {
          g.beginPath();
          g.moveTo(Math.round(ax) + 0.5, Math.round(ay) + 0.5);
          g.lineTo(Math.round(ax + (tx - ax) * Math.min(1, f * 3)) + 0.5, Math.round(ay + (ty - ay) * Math.min(1, f * 3)) + 0.5);
          g.stroke();
        }
        g.globalAlpha = 1;
        continue;
      }
      const [r, c] = e.at!;
      const cx = x0 + c * CELL + CELL / 2, cy = y0 + r * CELL + CELL / 2;
      const thick = Math.max(1, Math.round(8 * a));
      if (e.kind === "h" || e.kind === "cross") {
        for (const rr of e.kind === "cross" ? [r - 1, r, r + 1] : [r]) {
          fill("#ffffff", x0, y0 + rr * CELL + CELL / 2 - thick / 2, n * CELL, thick, a);
          fill(e.colour, x0, y0 + rr * CELL + CELL / 2 - thick / 4, n * CELL, Math.max(1, thick / 2), a);
        }
      }
      if (e.kind === "v" || e.kind === "cross") {
        for (const cc of e.kind === "cross" ? [c - 1, c, c + 1] : [c]) {
          fill("#ffffff", x0 + cc * CELL + CELL / 2 - thick / 2, y0, thick, n * CELL, a);
          fill(e.colour, x0 + cc * CELL + CELL / 2 - thick / 4, y0, Math.max(1, thick / 2), n * CELL, a);
        }
      }
      if (e.kind === "wrapped" || e.kind === "armed" || e.kind === "blast") {   // a square ring growing out of her cell
        const reach = (e.kind !== "blast" ? 1.5 : 2.5) * CELL * (0.3 + 0.7 * f);
        for (const [col, inset] of [["#ffffff", 0], [e.colour, 2]] as [string, number][]) {
          const rr = reach - inset;
          for (const [x, y, ww, hh] of [[cx - rr, cy - rr, 2 * rr, 2], [cx - rr, cy + rr - 2, 2 * rr, 2], [cx - rr, cy - rr, 2, 2 * rr], [cx + rr - 2, cy - rr, 2, 2 * rr]]) {
            fill(col, x, y, ww, hh, a);
          }
        }
      }
    }
  }

  function drawCanvas() {
    const th = theme();
    const { bg, fg, dim } = th;
    g.imageSmoothingEnabled = false;
    fill(bg, 0, 0, cw, ch);
    const x0 = MARGIN, y0 = TOP;
    const amp = Math.round((shakeAmp * shakeT) / shakeLen);
    const shake = amp ? [Math.round(rand(-amp, amp)), Math.round(rand(-amp, amp))] : [0, 0];

    drawText("SCORE", x0, 3, dim);   // header: score and best
    const rolling = shownScore < score;
    drawText(String(Math.floor(shownScore)), x0 + 24, 3, rolling ? colour(Math.floor(now * 12) % KINDS) : fg);
    const bestText = `BEST ${best}`;
    drawText(bestText, x0 + n * CELL - bestText.length * 4 + 1, 3, dim);

    g.save();
    g.translate(shake[0], shake[1]);
    fill(dim, x0 - 2, y0 - 2, n * CELL + 4, n * CELL + 4);   // board: a pixel frame and a checkerboard
    if (fever > 0) {   // fever: the frame runs through the five colours
      const side = n * CELL + 4, step = 6;
      for (let i = 0; i < 4 * side; i += step) {
        const col = GEM_COLOURS[(Math.floor(i / step) + Math.floor(now * 20)) % KINDS];
        const d = i % side;
        const rects = [[x0 - 2 + d, y0 - 2, step, 2], [x0 + n * CELL, y0 - 2 + d, 2, step],
          [x0 + n * CELL + 2 - d - step, y0 + n * CELL, step, 2], [x0 - 2, y0 + n * CELL + 2 - d - step, 2, step]];
        const [x, y, w, h] = rects[Math.floor(i / side)];
        fill(col, x, y, w, h);
      }
    }
    fill(bg, x0 - 1, y0 - 1, n * CELL + 2, n * CELL + 2);
    const light = mix(bg, fg, 0.05), darker = mix(bg, fg, 0.1);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) fill((r + c) % 2 === 0 ? light : darker, x0 + c * CELL, y0 + r * CELL, CELL, CELL);
    const hinted = new Set((hint ?? []).map((p) => `${p[0]},${p[1]}`));
    g.save();
    g.beginPath();
    g.rect(x0, y0, n * CELL, n * CELL);   // heads dropping in from above appear at the top edge
    g.clip();
    for (const sp of [...sprites.values()].sort((a, b) => Number(a.dying) - Number(b.dying))) {
      let x = x0 + sp.c * CELL, y = y0 + sp.r * CELL;
      const p = `${Math.round(sp.r)},${Math.round(sp.c)}`;
      if (selected && p === `${selected[0]},${selected[1]}` && !busy()) y -= 1 + Math.round(Math.sin(now * 8));   // selected: bobs
      if (hinted.has(p) && !busy()) x += Math.floor(now * 2) % 2 === 0 ? Math.round(Math.sin(now * 18)) : 0;   // hint: wiggles
      drawSprite(sp, x, y);
    }
    g.restore();
    if (selected && !busy()) {   // corner brackets in her colour
      const [r, c] = selected;
      const col = colour(board.at(selected)!.kind);
      const bx = x0 + c * CELL, by = y0 + r * CELL;
      for (const [dx, dy] of [[0, 0], [CELL - 3, 0], [0, CELL - 3], [CELL - 3, CELL - 3]]) {
        fill(col, bx + dx, by + dy + (dy === 0 ? 0 : 2), 3, 1);
        fill(col, bx + dx + (dx === 0 ? 0 : 2), by + dy, 1, 3);
      }
    }
    drawEffects();
    g.restore();

    for (const q of particles) {
      const a = 1 - q.t / q.life;
      if (q.shape === "star") {   // a little plus that grows and shrinks
        const size = Math.abs(q.t / q.life - 0.5) > 0.25 ? 1 : 2;
        fill(q.colour, q.x - size, q.y, 2 * size + 1, 1);
        fill(q.colour, q.x, q.y - size, 1, 2 * size + 1);
      } else if (q.shape === "confetti") {   // tumbles: wide, then tall
        const [w, h] = Math.floor(q.t * 10 + q.vx) % 2 ? [2, 1] : [1, 2];
        fill(q.colour, q.x, q.y, w, h, Math.min(1, 3 * a));
      } else fill(q.colour, q.x, q.y, 2, 2, a);
    }
    for (const e of texts) {
      const f = e.t / e.life;
      if (e.blink && Math.floor(e.t * 10) % 2) continue;
      drawText(e.s, e.x, e.y - e.rise * f, e.colour, e.size, true, 1 - Math.max(0, f - 0.6) / 0.4, "#120f18");
    }
    // footer: title in the five colours, and how to leave
    [..."MAGICA CRUSH"].forEach((chr, i) => {
      drawText(chr, x0 + i * 4, ch - 7, chr !== " " ? colour((i + Math.floor(now * 3)) % KINDS) : dim);
    });
    drawText("ESC QUIT", x0 + n * CELL - 31, ch - 7, dim);
    drawText(autoplay ? "AUTO" : "A AUTO", x0 + Math.floor((n * CELL) / 2) + 8, ch - 7, autoplay ? fg : dim, 1, true);
  }

  function render() {
    const th = theme();
    el.style.background = th.bg;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth, h = el.clientHeight;
    if (w <= 1 || h <= 1) return;
    let k = Math.min((w * dpr) / cw, (h * dpr) / ch);
    k = k >= 1 ? Math.floor(k) : k;   // whole-number scale keeps the pixels square
    const vw = Math.max(1, Math.round(cw * k)), vh = Math.max(1, Math.round(ch * k));
    if (view.width !== vw || view.height !== vh) {
      view.width = vw;
      view.height = vh;
      view.style.width = `${vw / dpr}px`;
      view.style.height = `${vh / dpr}px`;
    }
    origin = { x: 0, y: 0, k: k / dpr };
    drawCanvas();
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, vw, vh);
    vctx.drawImage(art, 0, 0, vw, vh);
  }

  raf = requestAnimationFrame(tick);
  return {
    kind: "crush",
    el,
    focus: () => el.focus(),
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      saveBest();
    },
  };
}

export type { Tile };
