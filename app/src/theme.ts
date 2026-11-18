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
  // (light is darker than a mirror of dark: dark text on a light ground reads thinner. Colours ≥ 6.5:1 on bg, the
  // bright ones ≥ 5:1, white 3.6:1 and bright black 4.6:1)
  light: {
    bg: "#f6efe1", fg: "#3d342d", dim: "#847b6d", sel_fg: "#fbf7ee", palette: [
      "#3b322b", "#8b3d32", "#475b32", "#6b5016", "#405771", "#714862", "#385b54", "#847c6c",
      "#746a5d", "#a34c3c", "#576d3e", "#7f6220", "#4e6883", "#845975", "#466d66", "#fbf7ee"],
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

function luminance(c: string): number {
  const [r, g, b] = hexRgb(c).map((x) => {
    x /= 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1…21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** `c` darkened (same hue and saturation) until it has at least `min` contrast on the light `bg`. */
export function legibleOn(c: string, bg: string, min: number): string {
  const rgb = hexRgb(c);
  let out = c;
  for (let k = 1; contrast(out, bg) < min && k > 0; k -= 0.01) out = hex(...(rgb.map((x) => x * k) as [number, number, number]));
  return out;
}

/** `c` lightened (toward white) until it has at least `min` contrast on the dark `bg`. */
export function legibleOnDark(c: string, bg: string, min: number): string {
  let out = c;
  for (let t = 0.02; contrast(out, bg) < min && t <= 1; t += 0.02) out = mix(c, "#ffffff", t);
  return out;
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
    // desaturating greys her colour toward the background (on light; on dark, her witch's murky one too): keep it readable
    const fix = (x: string) => (theme === "light" ? legibleOn(x, THEMES.light.bg, 5.5) : legibleOnDark(x, THEMES.dark.bg, 5.5));
    pal[at] = fix(col);
    pal[at + 1] = fix(desaturate(col, s.text_saturation));
    pal[at + 2] = fix(desaturate(col, s.path_saturation));
  });
  return pal;
}

/** Whether a pane's terminal is see-through. Dark: yes, her figure stands behind the text. Light: no, the terminal
 * paints the pane's own background and she's blended over it (style.css): glyphs drawn on a see-through canvas are
 * smoothed against nothing, which makes dark text on a light ground hairline-thin. */
export const seeThrough = (theme: ThemeName) => theme === "dark";

/** xterm.js's theme for a pane: her colour for the cursor and selection. The background is `paneBg` in light, and
 * see-through in dark (the pane draws it). */
export function xtermTheme(theme: ThemeName, colour: string, focused: boolean, s: Settings, paneBg: string = THEMES[theme].bg): ITheme {
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
    // see-through, but in the theme's colour: reverse video (a program's own cursor, a selected item) draws its text
    // in the background colour made opaque, which from #00000000 was black
    background: seeThrough(theme) ? t.bg + "00" : paneBg,
    cursor: colour,
    cursorAccent: t.bg,
    selectionBackground: colour,
    selectionForeground: t.sel_fg,
    selectionInactiveBackground: mix(colour, t.bg, 0.4),
    extendedAnsi: pal.slice(16),
  };
}
