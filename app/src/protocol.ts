// The escape sequences the shell scripts and programs send, and the terminal's answers:
//   OSC 9973 ; <verb>[;<arg>]   Magica's own commands (set, layout, crush, note, space)
//   OSC 133 ; A|B|C|D[;exit]    prompt / input / command start / command done
//   OSC 7 ; file://host/path    the shell's folder
//   OSC 10/11 ; ?               foreground / background colour query
//   CSI ? 2031 h/l, ? 996 n     light/dark change reports (answered with CSI ? 997 ; 1|2 n)
import type { CharName } from "./characters";

export const MAGICA_OSC = 9973;
const MAX_ARG = 4096;

export type MagicaCmd =
  | { verb: "set"; name: CharName }
  | { verb: "layout"; name: "pair" | "magica" }
  | { verb: "crush" }
  | { verb: "note" }
  | { verb: "space"; path: string };

export type Mark = { kind: "prompt" | "input" | "exec" } | { kind: "done"; exit: number };

const NAMES = new Set(["madoka", "homura", "sayaka", "mami", "kyoko", "kyubey"]);

/** A Magica command, or null for anything unknown or oversized. */
export function parseMagica(data: string): MagicaCmd | null {
  if (data.length > MAX_ARG) return null;
  const i = data.indexOf(";");
  const verb = i < 0 ? data : data.slice(0, i);
  const arg = i < 0 ? "" : data.slice(i + 1);
  switch (verb) {
    case "set":
      return NAMES.has(arg) ? { verb, name: arg as CharName } : null;
    case "layout":
      return arg === "pair" || arg === "magica" ? { verb, name: arg } : null;
    case "crush":
    case "note":
      return { verb };
    case "space":
      return { verb, path: arg };
  }
  return null;
}

/** The local path in an OSC 7 `file://host/path` URL (Windows drive paths get backslashes), or null. */
export function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:(\/|$)/.test(path)) return path.slice(1).replace(/\//g, "\\");
  return path;
}

export function parseOsc133(data: string): Mark | null {
  const [k, arg] = data.split(";");
  if (k === "A") return { kind: "prompt" };
  if (k === "B") return { kind: "input" };
  if (k === "C") return { kind: "exec" };
  if (k === "D") {
    const n = parseInt(arg ?? "", 10);
    return { kind: "done", exit: Number.isFinite(n) ? n : 0 };
  }
  return null;
}

export interface Handlers {
  onMagica(c: MagicaCmd): void;
  onCwd(path: string): void;
  onMark(m: Mark): void;
  onTitle(t: string): void;
  /** Send bytes back to the program, as if typed. */
  reply(s: string): void;
  theme(): { fg: string; bg: string; dark: boolean };
}

type Params = (number | number[])[];
interface ParserLike {
  registerOscHandler(ident: number, cb: (data: string) => boolean | Promise<boolean>): unknown;
  registerCsiHandler(id: { prefix?: string; intermediates?: string; final: string }, cb: (params: Params) => boolean | Promise<boolean>): unknown;
}
interface TermLike {
  parser: ParserLike;
  onTitleChange(cb: (t: string) => void): unknown;
}

function rgb(hex: string): string {
  return [1, 3, 5].map((i) => hex.slice(i, i + 2).repeat(2)).join("/");
}

/** Hook the protocol into a terminal. `themeChanged()` tells subscribed programs about a light/dark switch. */
export function install(term: TermLike, h: Handlers): { themeChanged(): void } {
  let reportTheme = false;
  const report = () => h.reply(`\x1b[?997;${h.theme().dark ? 1 : 2}n`);
  const p = term.parser;
  p.registerOscHandler(MAGICA_OSC, (data) => {
    const c = parseMagica(data);
    if (c) h.onMagica(c);
    return true;
  });
  p.registerOscHandler(7, (data) => {
    const path = parseOsc7(data);
    if (path) h.onCwd(path);
    return true;
  });
  p.registerOscHandler(133, (data) => {
    const m = parseOsc133(data);
    if (m) h.onMark(m);
    return true;
  });
  for (const n of [10, 11]) {
    p.registerOscHandler(n, (data) => {
      if (data !== "?") return false;
      const t = h.theme();
      h.reply(`\x1b]${n};rgb:${rgb(n === 10 ? t.fg : t.bg)}\x1b\\`);
      return true;
    });
  }
  const only2031 = (params: Params) => params.length === 1 && params[0] === 2031;
  p.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    if (!only2031(params)) return false;
    reportTheme = true;
    return true;
  });
  p.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
    if (!only2031(params)) return false;
    reportTheme = false;
    return true;
  });
  p.registerCsiHandler({ prefix: "?", intermediates: "$", final: "p" }, (params) => {
    if (!only2031(params)) return false;
    h.reply(`\x1b[?2031;${reportTheme ? 1 : 2}$y`);
    return true;
  });
  p.registerCsiHandler({ prefix: "?", final: "n" }, (params) => {
    if (params.length !== 1 || params[0] !== 996) return false;
    report();
    return true;
  });
  term.onTitleChange((t) => h.onTitle(t));
  return {
    themeChanged() {
      if (reportTheme) report();
    },
  };
}
