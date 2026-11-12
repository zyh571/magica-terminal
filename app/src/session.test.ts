import { describe, expect, test } from "vitest";
import { Terminal } from "@xterm/headless";
import { historyText, readTree, restoredText, HISTORY_LINES } from "./session";

describe("restored text", () => {
  test("lines and marker", () => {
    expect(restoredText("$ ls\na  b\n\n\n")).toBe("$ ls\r\na  b\r\n\x1b[2m── restored ──\x1b[0m\r\n");
  });
  test("control characters dropped", () => {
    expect(restoredText("x\x1b]0;magica:crush\x07y\x9b2Jz\tw").startsWith("x]0;magica:crushy2Jz\tw\r\n")).toBe(true);
  });
  test("empty", () => {
    expect(restoredText("")).toBe("");
    expect(restoredText(" \n \n")).toBe("");
  });
  test("keeps the last lines", () => {
    const text = Array.from({ length: HISTORY_LINES + 50 }, (_, i) => String(i)).join("\n");
    expect(restoredText(text).startsWith("50\r\n")).toBe(true);
  });
});

describe("history text", () => {
  const write = (t: Terminal, s: string) => new Promise<void>((r) => t.write(s, r));
  test("round trip through scrollback", async () => {
    const t = new Terminal({ cols: 30, rows: 5, allowProposedApi: true });
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i} ${"x".repeat(i)}`);
    await write(t, lines.join("\r\n"));
    expect(historyText(t)).toBe(lines.join("\n"));
    const t2 = new Terminal({ cols: 30, rows: 5, allowProposedApi: true });
    await write(t2, restoredText(historyText(t)));
    expect(historyText(t2).split("\n").slice(0, -1).join("\n")).toBe(historyText(t));
  });
  test("full-screen app gives its screen", async () => {
    const t = new Terminal({ cols: 20, rows: 3, allowProposedApi: true });
    await write(t, "before\r\n\x1b[?1049h\x1b[Hvim screen");
    expect(historyText(t)).toBe("vim screen");
  });
});

describe("reading a saved tree", () => {
  test("old Python sessions: claude key and kyubey", () => {
    const n = readTree({
      orient: "h", ratio: 0.3,
      a: { char: "kyubey", cwd: "/root", text: "x" },
      b: { char: "homura", cwd: "/tmp/Zoë d", claude: "0b5e7f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" },
    });
    expect(n).toEqual({
      kind: "split", orient: "h", ratio: 0.3,
      a: { kind: "pane", char: "madoka", cwd: "/root", text: "x", resume: undefined },
      b: { kind: "pane", char: "homura", cwd: "/tmp/Zoë d", text: undefined, resume: "claude:0b5e7f3a-1c2d-4e5f-8a9b-0c1d2e3f4a5b" },
    });
  });
  test("garbage", () => {
    expect(readTree(null)).toBeNull();
    expect(readTree({ char: "nobody" })).toEqual({ kind: "pane", char: "madoka", cwd: undefined, text: undefined, resume: undefined });
    expect(readTree({ orient: "x", a: {}, b: {} })).toBeNull();
    expect(readTree({ orient: "h", ratio: 7, a: { char: "mami" }, b: { char: "kyoko" } })).toMatchObject({ ratio: 0.5 });
  });
});
