import { describe, expect, test } from "vitest";
import { desaturate, mix, palette, THEMES, xterm256 } from "./theme";
import { DEFAULTS } from "./settings";
import { slotOf } from "./characters";

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
  test("dark", () => {
    const p = palette("dark", DEFAULTS);
    expect(p[100]).toBe("#ff9cc6");
    expect(p[101]).toBe("#e9b2c9");
    expect(p[102]).toBe("#e1baca");
    expect(p[103]).toBe("#b9a0ff");
    expect(p[115]).toBe("#f4f4f4");
    expect(p[116]).toBe("#c9c9cc");
    expect(p[118]).toBe("#8a8a8f");
  });
  test("light", () => {
    const p = palette("light", DEFAULTS);
    expect(p[100]).toBe("#c2386f");
    expect(p[101]).toBe("#a35775");
    expect(p[118]).toBe("#7a7a80");
  });
});
