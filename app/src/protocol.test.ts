import { describe, expect, test } from "vitest";
import { Terminal } from "@xterm/headless";
import { install, parseMagica, parseOsc133, parseOsc7 } from "./protocol";

describe("parseMagica", () => {
  test("verbs", () => {
    expect(parseMagica("set;homura")).toEqual({ verb: "set", name: "homura" });
    expect(parseMagica("set;kyubey")).toEqual({ verb: "set", name: "kyubey" });
    expect(parseMagica("layout;magica")).toEqual({ verb: "layout", name: "magica" });
    expect(parseMagica("crush")).toEqual({ verb: "crush" });
    expect(parseMagica("note")).toEqual({ verb: "note" });
    expect(parseMagica("space;/tmp/a b;c")).toEqual({ verb: "space", path: "/tmp/a b;c" });
    expect(parseMagica("space")).toEqual({ verb: "space", path: "" });
  });
  test("rejects anything else", () => {
    expect(parseMagica("set;nobody")).toBeNull();
    expect(parseMagica("layout;grid")).toBeNull();
    expect(parseMagica("rm;-rf")).toBeNull();
    expect(parseMagica("")).toBeNull();
    expect(parseMagica("x".repeat(100000))).toBeNull();
    expect(parseMagica("space;" + "x".repeat(100000))).toBeNull();
  });
});

describe("OSC 7 and 133", () => {
  test("cwd", () => {
    expect(parseOsc7("file://host/home/u/My%20Files/Zo%C3%AB")).toBe("/home/u/My Files/Zoë");
    expect(parseOsc7("file:///tmp")).toBe("/tmp");
    expect(parseOsc7("file://pc/C:/Users/Zo%C3%AB/My%20Files")).toBe("C:\\Users\\Zoë\\My Files");
    expect(parseOsc7("http://x/y")).toBeNull();
    expect(parseOsc7("file://h/%E0%A4%A")).toBeNull();
  });
  test("marks", () => {
    expect(parseOsc133("A")).toEqual({ kind: "prompt" });
    expect(parseOsc133("B")).toEqual({ kind: "input" });
    expect(parseOsc133("C")).toEqual({ kind: "exec" });
    expect(parseOsc133("D;1")).toEqual({ kind: "done", exit: 1 });
    expect(parseOsc133("D")).toEqual({ kind: "done", exit: 0 });
    expect(parseOsc133("D;x")).toEqual({ kind: "done", exit: 0 });
    expect(parseOsc133("Z")).toBeNull();
  });
});

function setup(dark = true) {
  const term = new Terminal({ allowProposedApi: true });
  const replies: string[] = [];
  const got: unknown[] = [];
  const api = install(term, {
    onMagica: (c) => got.push(c),
    onCwd: (p) => got.push(["cwd", p]),
    onMark: (m) => got.push(m),
    onTitle: (t) => got.push(["title", t]),
    reply: (s) => replies.push(s),
    theme: () => ({ fg: "#efe3cc", bg: "#2b231c", dark }),
  });
  const write = (s: string) => new Promise<void>((r) => term.write(s, r));
  return { term, replies, got, api, write };
}

describe("install", () => {
  test("dispatches commands, cwd and marks", async () => {
    const { got, write } = setup();
    await write("\x1b]9973;set;homura\x1b\\\x1b]7;file:///tmp\x07\x1b]133;D;2\x1b\\\x1b]9973;bogus\x07");
    expect(got).toEqual([{ verb: "set", name: "homura" }, ["cwd", "/tmp"], { kind: "done", exit: 2 }]);
  });
  test("answers colour queries", async () => {
    const { replies, write } = setup();
    await write("\x1b]11;?\x1b\\\x1b]10;?\x07");
    expect(replies).toEqual(["\x1b]11;rgb:2b2b/2323/1c1c\x1b\\", "\x1b]10;rgb:efef/e3e3/cccc\x1b\\"]);
  });
  test("reports light/dark to subscribers", async () => {
    const s = setup(true);
    s.api.themeChanged();
    expect(s.replies).toEqual([]);
    await s.write("\x1b[?2031h");
    s.api.themeChanged();
    await s.write("\x1b[?996n\x1b[?2031$p");
    expect(s.replies).toEqual(["\x1b[?997;1n", "\x1b[?997;1n", "\x1b[?2031;1$y"]);
    await s.write("\x1b[?2031l\x1b[?2031$p");
    expect(s.replies.at(-1)).toBe("\x1b[?2031;2$y");
  });
  test("leaves other private modes to xterm", async () => {
    const { term, write } = setup();
    await write("\x1b[?25l");
    expect((term as any)._core.coreService.isCursorHidden).toBe(true);
  });
  test("titles reach onTitle", async () => {
    const { got, write } = setup();
    await write("\x1b]0;madoka@magica: ~/x\x07");
    expect(got).toEqual([["title", "madoka@magica: ~/x"]]);
  });
});
