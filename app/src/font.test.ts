import { describe, expect, test } from "vitest";
import { cellSpacing } from "./font";

describe("cell width", () => {
  // xterm makes a cell floor(char width × dpr) device pixels wide plus round(letterSpacing):
  // the spacing gives back the pixel the floor took, so glyphs don't overlap (VTE rounds up too)
  test("a fractional width gets the lost pixel back", () => {
    expect(cellSpacing(8.8125, 1)).toBe(1); // Maple Mono at 11pt
    expect(cellSpacing(8.05, 1)).toBe(1);
  });
  test("a whole width is left alone", () => {
    expect(cellSpacing(9, 1)).toBe(0);
    expect(cellSpacing(9.0000004, 1)).toBe(0); // measuring noise
  });
  test("works in device pixels", () => {
    expect(cellSpacing(8.5, 2)).toBe(0); // 17 device px exactly
    expect(cellSpacing(8.8125, 2)).toBe(1); // 17.625 → 18
  });
});
