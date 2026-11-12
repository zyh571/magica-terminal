// Colours: the two themes, colour maths matching the old Python app, and the 256-colour palette with her slots.
import type { ITheme } from "@xterm/xterm";
import { ALL_CHARACTERS, CHAR_SLOTS, KYUBEY_GREYS, RED_SLOT } from "./characters";
import type { Settings } from "./settings";

export type ThemeName = "dark" | "light";

export interface Theme {
  bg: string;
  fg: string;
  dim: string;
  sel_fg: string;
  palette: string[];
}

/** Creamy palettes: cocoa with cream text on dark, warm cream with brown text on light. */
export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    bg: "#2b231c", fg: "#efe3cc", dim: "#93846f", sel_fg: "#1f1b17", palette: [
      "#3a3029", "#d27a68", "#9cad7a", "#dcb468", "#8ca3bd", "#c095ae", "#8db5a8", "#d9cfbd",
      "#75695c", "#e3917f", "#b2c38f", "#ecc982", "#a4b9cf", "#d2abc1", "#a5c9bc", "#f5ecdc"],
  },
  light: {
    bg: "#f6efe1", fg: "#4a3f36", dim: "#a39886", sel_fg: "#fbf7ee", palette: [
      "#3b322b", "#a8493c", "#5f7a43", "#8e6a1d", "#4b6684", "#8a5878", "#4b7a70", "#b4a993",
      "#857a6b", "#c25a48", "#708d50", "#ad862b", "#5d7c9c", "#9e6a8c", "#5c9086", "#fbf7ee"],
  },
};

export function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function hex(r: number, g: number, b: number): string {
  // Python's round() rounds halves to even; match it so colours are identical to the old app's
  const rnd = (x: number) => {
    const f = Math.floor(x), d = x - f;
    return d > 0.5 || (d === 0.5 && f % 2 === 1) ? f + 1 : f;
  };
  return "#" + [r, g, b].map((v) => rnd(v).toString(16).padStart(2, "0")).join("");
}

// Python's colorsys
function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b), sumc = maxc + minc, rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - sumc);
  const rc = (maxc - r) / rangec, gc = (maxc - g) / rangec, bc = (maxc - b) / rangec;
  let h = r === maxc ? bc - gc : g === maxc ? 2 + rc - bc : 4 + gc - rc;
  h = (((h / 6) % 1) + 1) % 1;
  return [h, l, s];
}

function v(m1: number, m2: number, hue: number): number {
  hue = ((hue % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}

function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  return [v(m1, m2, h + 1 / 3), v(m1, m2, h), v(m1, m2, h - 1 / 3)];
}

/** `hex` with its saturation scaled by `amount`. */
export function desaturate(c: string, amount: number): string {
  const [r, g, b] = hexRgb(c).map((x) => x / 255);
  const [h, l, s] = rgbToHls(r, g, b);
  const [r2, g2, b2] = hlsToRgb(h, l, s * amount);
  return hex(r2 * 255, g2 * 255, b2 * 255);
}

/** Blend colour a toward b by fraction t. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexRgb(a), cb = hexRgb(b);
  return hex(...(ca.map((x, i) => x + (cb[i] - x) * t) as [number, number, number]));
}

/** Our 16 colours, then the standard xterm 6×6×6 cube and the grey ramp. */
export function xterm256(base16: string[]): string[] {
  const steps = [0, 95, 135, 175, 215, 255];
  const pal = [...base16];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) pal.push(hex(steps[r], steps[g], steps[b]));
  for (let i = 0; i < 24; i++) pal.push(hex(8 + 10 * i, 8 + 10 * i, 8 + 10 * i));
  return pal;
}

/** The full palette for a theme, each character's three slots holding her name / text / path colours. */
export function palette(theme: ThemeName, s: Settings): string[] {
  const pal = xterm256(THEMES[theme].palette);
  ALL_CHARACTERS.forEach((c, i) => {
    const at = CHAR_SLOTS + 3 * i;
    if (c.name === "kyubey") {
      const g = KYUBEY_GREYS[theme];
      pal.splice(at, 3, g[0], g[1], g[2]);
      pal[RED_SLOT] = g[3];
      return;
    }
    const col = theme === "dark" ? c.dark : c.light;
    pal[at] = col;
    pal[at + 1] = desaturate(col, s.text_saturation);
    pal[at + 2] = desaturate(col, s.path_saturation);
  });
  return pal;
}

/** xterm.js's theme for a pane: her colour for the cursor and selection; the background is see-through (the pane draws it). */
export function xtermTheme(theme: ThemeName, colour: string, focused: boolean, s: Settings): ITheme {
  const t = THEMES[theme];
  const pal = palette(theme, s);
  const fg = focused ? t.fg : desaturate(t.fg, s.unfocused_saturation);
  const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
  const base: Record<string, string> = {};
  names.forEach((n, i) => {
    base[n] = pal[i];
    base["bright" + n[0].toUpperCase() + n.slice(1)] = pal[i + 8];
  });
  return {
    ...base,
    foreground: fg,
    background: "#00000000",
    cursor: colour,
    cursorAccent: t.bg,
    selectionBackground: colour,
    selectionForeground: t.sel_fg,
    selectionInactiveBackground: mix(colour, t.bg, 0.4),
    extendedAnsi: pal.slice(16),
  };
}
