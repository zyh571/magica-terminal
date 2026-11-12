// The figure's geometry and motion, and how much text sits behind her (for fading her out of the way). Pure maths,
// ported from the old app.
import type { IBufferLine } from "@xterm/xterm";
import type { Settings } from "./settings";
import { hexRgb } from "./theme";

export interface Anim {
  stretch: number;   // height factor (breathing, squash)
  widen: number;     // width factor (squash)
  hop: number;       // px at full screen
}

export interface FigureBox {
  w: number; h: number; right: number; bottom: number; scale: number;
  baseW: number; baseH: number; baseRight: number; baseBottom: number;
}

/** Where she goes in a pane (px from its right and bottom edges). Like Ghostty's "cover" on a 16:9 canvas: a pane
 * keeps the full-screen (1920x1080) size while either its width or height is still full, and shrinks once both do. */
export function figureBox(paneW: number, paneH: number, imgW: number, imgH: number, s: Settings, name: string, a: Anim): FigureBox {
  const scale = Math.max(paneW / 1920, paneH / 1080);
  const fh = Math.max(1, Math.round(s.fig_height * scale));
  const h = Math.max(1, Math.round(fh * a.stretch));   // breathing / squash change her height (and width), feet stay put
  const fw = Math.max(1, Math.round((imgW * fh) / imgH));
  const w = Math.max(1, Math.round(fw * a.widen));
  return {
    w, h, scale,
    right: Math.max(0, Math.round(s.fig_right * scale - (w - fw) / 2)),   // widen around her centre
    bottom: (name === "kyubey" ? 0 : Math.round(s.fig_bottom * scale)) + Math.round(a.hop * scale),
    baseW: fw,
    baseH: Math.max(Math.round(s.base_height * scale), 3),   // never thinner than 3px in small panes
    baseRight: Math.round(s.fig_right * scale),
    baseBottom: Math.round(s.base_gap * scale),
  };
}

/** `hops` bounces over t = 0…1, each lower than the last. */
export function hopOffset(t: number, height: number, hops: number): number {
  if (t >= 1 || t <= 0) return 0;
  const phase = t * hops, f = phase % 1;
  return height * (1 - Math.floor(phase) / hops) * 4 * f * (1 - f);
}

/** A failure: a quick squash, then easing back. */
export function squashAt(t: number, amount: number): { stretch: number; widen: number } {
  if (t >= 1) return { stretch: 1, widen: 1 };
  const a = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85) ** 2;
  return { stretch: 1 - amount * a, widen: 1 + amount * 0.6 * a };
}

/** An idle breath: taller and back, smoothly. */
export function breathAt(t: number, amount: number): number {
  return t >= 1 ? 1 : 1 + amount * Math.sin(Math.PI * t) ** 2;
}

/** 0…1: the largest channel difference between two colours. */
export function colourDiff(a: string, b: string): number {
  const x = hexRgb(a), y = hexRgb(b);
  return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) / 255;
}

/** Does a cell show anything on a `bg` background? Text in a colour that stands out from its cell, or a cell whose
 * own colour stands out; blanks and text the colour of its cell don't. */
export function cellInk(ch: string, ink: string, cell: string, bg: string, contrast: number): boolean {
  const filled = colourDiff(cell, bg) > contrast, visible = colourDiff(ink, cell) > contrast;
  return filled || (visible && ch.trim() !== "");
}

export interface InkColours {
  fg: string;
  bg: string;
  palette: string[];
  contrast: number;
}

const rgbHex = (n: number) => "#" + n.toString(16).padStart(6, "0");

/** Which cells c0…c1 of a terminal line show anything (see cellInk). */
export function lineInks(line: IBufferLine, c0: number, c1: number, k: InkColours): boolean[] {
  const out: boolean[] = [];
  for (let c = c0; c < c1; c++) {
    const cell = line.getCell(c);
    if (!cell) {
      out.push(false);
      continue;
    }
    if (cell.getWidth() === 0) {   // the second half of a wide character
      out.push(out.length ? out[out.length - 1] : false);
      continue;
    }
    let ink = cell.isFgRGB() ? rgbHex(cell.getFgColor()) : cell.isFgPalette() ? k.palette[cell.getFgColor()] : k.fg;
    let back = cell.isBgRGB() ? rgbHex(cell.getBgColor()) : cell.isBgPalette() ? k.palette[cell.getBgColor()] : k.bg;
    if (cell.isInverse()) [ink, back] = [back, ink];
    out.push(cellInk(cell.getChars() || " ", ink, back, k.bg, k.contrast));
  }
  return out;
}

/** Per pixel row of the figure: [first, last] x where she's solid (alpha > 64), or null. */
export function solidSpans(rgba: Uint8ClampedArray, w: number, h: number): ([number, number] | null)[] {
  const spans: ([number, number] | null)[] = [];
  for (let y = 0; y < h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 64) {
        if (first < 0) first = x;
        last = x;
      }
    }
    spans.push(first < 0 ? null : [first, last]);
  }
  return spans;
}

/** How much of her solid part has text (or a coloured cell) behind it, 0…1: every cell counts by how much of her
 * covers it. `origin` is her top-left relative to the first cell. */
export function coverFraction(
  spans: ([number, number] | null)[],
  origin: { x: number; y: number },
  cell: { w: number; h: number; cols: number; rows: number },
  inked: (row: number, col: number) => boolean,
): number {
  const weights = new Map<string, number>();
  let total = 0;
  spans.forEach((span, y) => {
    if (!span) return;
    const x0 = origin.x + span[0], x1 = origin.x + span[1] + 1;
    total += x1 - x0;
    const py = origin.y + y;
    const r = Math.floor(py / cell.h);
    if (py < 0 || r >= cell.rows) return;
    for (let c = Math.max(0, Math.floor(x0 / cell.w)); c < Math.min(cell.cols, Math.floor((x1 - 1) / cell.w) + 1); c++) {
      const key = `${r},${c}`;
      weights.set(key, (weights.get(key) ?? 0) + Math.min(x1, (c + 1) * cell.w) - Math.max(x0, c * cell.w));
    }
  });
  let ink = 0;
  for (const [key, w] of weights) {
    const [r, c] = key.split(",").map(Number);
    if (inked(r, c)) ink += w;
  }
  return total ? ink / total : 0;
}
