import { describe, expect, test } from "vitest";
import { Terminal } from "@xterm/headless";
import { breathAt, cellInk, coverFraction, figureBox, hopOffset, lineInks, solidSpans, squashAt } from "./cover";
import { DEFAULTS } from "./settings";
import { xterm256 } from "./theme";

// The old app's cell_inks tests (tests/test_cover.py), on cells of a real terminal instead of VTE's HTML export.
const FG = "#d4d2cc", BG = "#1d1d1c";
const PAL = xterm256(Array(16).fill("#808080"));

async function ink(text: string, cols = 20): Promise<string> {
  const t = new Terminal({ cols, rows: 2, allowProposedApi: true });
  await new Promise<void>((r) => t.write(text, r));
  const inks = lineInks(t.buffer.active.getLine(0)!, 0, cols, { fg: FG, bg: BG, palette: PAL, contrast: 0.12 });
  const s = inks.map((on) => (on ? "x" : ".")).join("");
  return s.slice(0, [...text.replace(/\x1b\[[^m]*m/g, "")].reduce((n, ch) => n + (/[　-鿿]/.test(ch) ? 2 : 1), 0));
}

describe("cell inks", () => {
  test("blank", async () => expect(await ink("      ")).toBe("......"));
  test("plain text", async () => expect(await ink("  ls -la")).toBe("..xx.xxx"));
  test("coloured cell without text", async () => expect(await ink("\x1b[48;2;192;0;0m   \x1b[0m")).toBe("xxx"));
  test("cell the colour of the background", async () => expect(await ink("\x1b[48;2;30;30;29m   \x1b[0m")).toBe("..."));
  test("text the colour of its cell", async () => {
    expect(await ink("\x1b[38;2;31;31;30mhidden\x1b[0m")).toBe("......");
    expect(await ink("\x1b[38;5;100mslot\x1b[0m")).toBe("xxxx");   // a palette colour
  });
  test("nesting", async () => {
    expect(await ink("\x1b[48;2;212;210;204m\x1b[38;2;0;0;0mR\x1b[39m \x1b[0ma")).toBe("xxx");
    expect(await ink("\x1b[38;2;29;29;28mx\x1b[0m y")).toBe("..x");
  });
  test("inverse and wide characters", async () => {
    expect(await ink("\x1b[7m \x1b[0m")).toBe("x");
    expect(await ink("魔法 x")).toBe("xxxx.x");
  });
  test("cellInk directly", () => {
    expect(cellInk("a", FG, BG, BG, 0.12)).toBe(true);
    expect(cellInk(" ", FG, BG, BG, 0.12)).toBe(false);
    expect(cellInk(" ", FG, "#c00000", BG, 0.12)).toBe(true);
  });
});

describe("figure placement", () => {
  test("full screen", () => {
    const b = figureBox(1920, 1080, 300, 600, DEFAULTS, "madoka", { stretch: 1, widen: 1, hop: 0 });
    expect(b).toMatchObject({ w: 120, h: 240, right: 30, bottom: 12, scale: 1 });
  });
  test("keeps its size while one side is still full", () => {
    const b = figureBox(960, 1080, 300, 600, DEFAULTS, "madoka", { stretch: 1, widen: 1, hop: 0 });
    expect(b.h).toBe(240);
  });
  test("shrinks with both sides", () => {
    const b = figureBox(960, 540, 300, 600, DEFAULTS, "madoka", { stretch: 1, widen: 1, hop: 0 });
    expect(b).toMatchObject({ h: 120, right: 15, bottom: 6, scale: 0.5 });
  });
  test("kyubey sits on the bottom edge; hops lift her", () => {
    expect(figureBox(1920, 1080, 300, 600, DEFAULTS, "kyubey", { stretch: 1, widen: 1, hop: 0 }).bottom).toBe(0);
    expect(figureBox(1920, 1080, 300, 600, DEFAULTS, "madoka", { stretch: 1, widen: 1, hop: 10 }).bottom).toBe(22);
  });
  test("squash: shorter and wider around her centre, feet stay put", () => {
    const b = figureBox(1920, 1080, 300, 600, DEFAULTS, "madoka", { stretch: 0.8, widen: 1.1, hop: 0 });
    expect(b.h).toBe(192);
    expect(b.w).toBe(132);
    expect(b.right).toBe(24);   // 30 - (132 - 120) / 2
  });
});

describe("animation curves", () => {
  test("hop", () => {
    expect(hopOffset(0, 22, 3)).toBe(0);
    expect(hopOffset(0.5 / 3, 22, 3)).toBeCloseTo(22);
    expect(hopOffset(1.5 / 3, 22, 3)).toBeCloseTo(22 * 2 / 3);
    expect(hopOffset(1, 22, 3)).toBe(0);
  });
  test("squash", () => {
    expect(squashAt(0.15, 0.15).stretch).toBeCloseTo(0.85);
    expect(squashAt(0.15, 0.15).widen).toBeCloseTo(1.09);
    expect(squashAt(1, 0.15)).toEqual({ stretch: 1, widen: 1 });
  });
  test("breath", () => {
    expect(breathAt(0.5, 0.04)).toBeCloseTo(1.04);
    expect(breathAt(1, 0.04)).toBe(1);
  });
});

describe("cover", () => {
  test("solid spans", () => {
    // 3x2 image: row 0 solid in the middle, row 1 empty
    const a = new Uint8ClampedArray([0, 0, 0, 10, 0, 0, 0, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(solidSpans(a, 3, 2)).toEqual([[1, 1], null]);
  });
  test("fraction of her that has text behind", () => {
    const spans: ([number, number] | null)[] = [[0, 19], [0, 19]];   // 20 px wide, 2 px high
    const cell = { w: 10, h: 10, cols: 4, rows: 4 };
    expect(coverFraction(spans, { x: 0, y: 0 }, cell, () => false)).toBe(0);
    expect(coverFraction(spans, { x: 0, y: 0 }, cell, () => true)).toBe(1);
    expect(coverFraction(spans, { x: 0, y: 0 }, cell, (_r, c) => c === 0)).toBe(0.5);
    expect(coverFraction(spans, { x: 5, y: 0 }, cell, (_r, c) => c === 0)).toBe(0.25);
    expect(coverFraction(spans, { x: 0, y: -5 }, cell, () => true)).toBe(0);   // above the first row: nothing
  });
});
