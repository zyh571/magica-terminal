import { describe, expect, test } from "vitest";
import { contrast, desaturate, legibleOnDark, mix, palette, seeThrough, THEMES, xterm256, xtermTheme } from "./theme";
import { DEFAULTS } from "./settings";
import { CHARACTERS, slotOf } from "./characters";

describe("colours", () => {
  test("desaturate matches the Python app", () => {
    expect(desaturate("#ff9cc6", 0.55)).toBe("#e9b2c9");
    expect(desaturate("#ff9cc6", 0.4)).toBe("#e1baca");
    expect(desaturate("#c2386f", 0.55)).toBe("#a35775");
    expect(desaturate("#efe3cc", 1.0)).toBe("#efe3cc");
  });
  test("mix", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#ff0000", "#0000ff", 0)).toBe("#ff0000");
  });
  test("xterm256", () => {
    const p = xterm256(THEMES.dark.palette);
    expect(p.length).toBe(256);
    expect(p[0]).toBe(THEMES.dark.palette[0]);
    expect(p[16]).toBe("#000000");
    expect(p[231]).toBe("#ffffff");
    expect(p[232]).toBe("#080808");
    expect(p[255]).toBe("#eeeeee");
  });
});

describe("palette slots", () => {
  test("slots", () => {
    expect(slotOf("madoka")).toBe(100);
    expect(slotOf("kyubey")).toBe(115);
  });
  test("dark: her witch's colours", () => {
    const p = palette("dark", DEFAULTS);
    CHARACTERS.forEach((c, i) => {
      expect(p[100 + 3 * i]).toBe(c.dark);
      const readable = (x: string) => legibleOnDark(x, THEMES.dark.bg, 5.5);
      expect(p[101 + 3 * i]).toBe(readable(desaturate(c.dark, DEFAULTS.text_saturation)));
      expect(p[102 + 3 * i]).toBe(readable(desaturate(c.dark, DEFAULTS.path_saturation)));
    });
    expect(p[100]).toBe("#d88aab");   // Kriemhild: Madoka's pink, murky
    expect(p[115]).toBe("#f4f4f4");
    expect(p[116]).toBe("#c9c9cc");
    expect(p[118]).toBe("#8a8a8f");
  });
  test("dark: the witches' name, text and path colours are readable however desaturated", () => {
    for (const s of [DEFAULTS, { ...DEFAULTS, text_saturation: 0, path_saturation: 0.1 }]) {
      const p = palette("dark", s);
      for (let i = 100; i < 115; i++) expect(contrast(p[i], THEMES.dark.bg)).toBeGreaterThanOrEqual(5.5);
    }
  });
  test("light", () => {
    const p = palette("light", DEFAULTS);
    expect(p[100]).toBe("#a02e5c");
    expect(p[118]).toBe("#7a7a80");
  });
  test("light: her name, text and path colours stay readable however desaturated", () => {
    for (const s of [DEFAULTS, { ...DEFAULTS, text_saturation: 0, path_saturation: 0.1 }]) {
      const p = palette("light", s);
      for (let i = 100; i < 115; i++) expect(contrast(p[i], THEMES.light.bg)).toBeGreaterThanOrEqual(5.5);
    }
  });
  test("light: text, and the ANSI colours programs use for text, are readable", () => {
    const t = THEMES.light;
    expect(contrast(t.fg, t.bg)).toBeGreaterThanOrEqual(10);
    [1, 2, 3, 4, 5, 6].forEach((i) => expect(contrast(t.palette[i], t.bg)).toBeGreaterThanOrEqual(6.5));
    [9, 10, 11, 12, 13, 14].forEach((i) => expect(contrast(t.palette[i], t.bg)).toBeGreaterThanOrEqual(5));
  });
  test("dark: see-through, in the theme's colour (reverse video isn't black)", () => {
    expect(seeThrough("dark")).toBe(true);
    expect(xtermTheme("dark", "#ff9cc6", true, DEFAULTS, "#123456").background).toBe(THEMES.dark.bg + "00");
  });
  test("light: opaque, in the pane's own background (so text is smoothed against it)", () => {
    expect(seeThrough("light")).toBe(false);
    expect(xtermTheme("light", "#a02e5c", true, DEFAULTS, "#f0e6dc").background).toBe("#f0e6dc");
    expect(xtermTheme("light", "#a02e5c", true, DEFAULTS).background).toBe(THEMES.light.bg);
  });
});
