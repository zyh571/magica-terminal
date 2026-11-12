import { describe, expect, test } from "vitest";
import { actionFor, KeyLike } from "./keys";

const key = (code: string, mods: string, keyName?: string): KeyLike => ({
  code,
  key: keyName ?? (code.startsWith("Key") ? code.slice(3).toLowerCase() : code),
  ctrlKey: mods.includes("c"),
  shiftKey: mods.includes("s"),
  altKey: mods.includes("a"),
  metaKey: mods.includes("m"),
});

describe("Linux / Windows", () => {
  const a = (code: string, mods: string, k?: string) => actionFor(key(code, mods, k), "other");
  test("Ctrl+Shift", () => {
    expect(a("KeyO", "cs")).toBe("splitRight");
    expect(a("KeyE", "cs")).toBe("splitDown");
    expect(a("KeyW", "cs")).toBe("close");
    expect(a("KeyT", "cs")).toBe("newTab");
    expect(a("KeyC", "cs")).toBe("copy");
    expect(a("KeyV", "cs")).toBe("paste");
    expect(a("Equal", "cs", "+")).toBe("fontUp");
    expect(a("Minus", "cs", "_")).toBe("fontDown");
    expect(a("Digit0", "cs", ")")).toBe("fontReset");
    expect(a("KeyL", "cs")).toBe("toggleTheme");
    expect(a("KeyF", "cs")).toBe("search");
  });
  test("tabs and panes", () => {
    expect(a("PageUp", "c")).toBe("prevTab");
    expect(a("PageDown", "c")).toBe("nextTab");
    expect(a("Digit3", "c", "3")).toEqual({ tab: 3 });
    expect(a("Digit9", "c", "9")).toEqual({ tab: 9 });
    expect(a("Numpad2", "c", "2")).toEqual({ tab: 2 });
    expect(a("ArrowLeft", "ca")).toEqual({ move: [-1, 0] });
    expect(a("ArrowDown", "ca")).toEqual({ move: [0, 1] });
  });
  test("everything else goes to the program", () => {
    expect(a("KeyC", "c")).toBeNull();
    expect(a("KeyO", "c")).toBeNull();
    expect(a("KeyD", "m")).toBeNull();
    expect(a("KeyL", "csa")).toBeNull();
  });
});

describe("macOS", () => {
  const a = (code: string, mods: string, k?: string) => actionFor(key(code, mods, k), "mac");
  test("Cmd", () => {
    expect(a("KeyD", "m")).toBe("splitRight");
    expect(a("KeyD", "ms")).toBe("splitDown");
    expect(a("KeyW", "m")).toBe("close");
    expect(a("KeyT", "m")).toBe("newTab");
    expect(a("KeyC", "m")).toBe("copy");
    expect(a("KeyV", "m")).toBe("paste");
    expect(a("Equal", "m", "=")).toBe("fontUp");
    expect(a("Equal", "ms", "+")).toBe("fontUp");
    expect(a("Minus", "m", "-")).toBe("fontDown");
    expect(a("Digit0", "m", "0")).toBe("fontReset");
    expect(a("KeyL", "ms")).toBe("toggleTheme");
    expect(a("KeyF", "m")).toBe("search");
    expect(a("BracketLeft", "ms", "{")).toBe("prevTab");
    expect(a("BracketRight", "ms", "}")).toBe("nextTab");
    expect(a("Digit4", "m", "4")).toEqual({ tab: 4 });
    expect(a("ArrowUp", "ma")).toEqual({ move: [0, -1] });
  });
  test("Ctrl and Option go to the program", () => {
    expect(a("KeyC", "c")).toBeNull();
    expect(a("KeyO", "cs")).toBeNull();
    expect(a("KeyB", "a")).toBeNull();
    expect(a("PageUp", "c")).toBeNull();
  });
});
