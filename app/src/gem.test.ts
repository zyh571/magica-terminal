import { describe, expect, test } from "vitest";
import { taskbarIconBackground, taskbarSeedTurn } from "./gem";

describe("taskbar gem", () => {
  test("uses the same muted light-side backing in both themes", () => {
    expect(taskbarIconBackground("madoka")).toBe("#d5a6ae");
    expect(taskbarIconBackground("homura")).toBe("#bfafce");
    expect(taskbarIconBackground("kyubey")).toBe("#7a7a80");
  });

  test("normalises the grief-seed source angles to 58 degrees", () => {
    expect(taskbarSeedTurn("madoka")).toBe(1.3);
    expect(taskbarSeedTurn("sayaka")).toBe(4.6);
    expect(taskbarSeedTurn("kyoko")).toBe(-1.3);
    expect(taskbarSeedTurn("kyubey")).toBe(0);
  });
});
