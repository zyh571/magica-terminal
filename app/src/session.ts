// The session's pieces that are plain logic: a pane's text, what a restored pane shows first, and reading a saved
// tree (including the old Python app's session.json).
import { characterNamed, type CharName } from "./characters";
import type { Orient } from "./layout";

export const HISTORY_LINES = 2000;

export type SavedNode =
  | { kind: "pane"; char: CharName; cwd?: string; text?: string; resume?: string }
  | { kind: "split"; orient: Orient; ratio: number; a: SavedNode; b: SavedNode };

/** What a restored pane shows before its new prompt: the saved text (plain, control characters dropped, since anything
 * could be in the file) and a faint "restored" line under it. */
export function restoredText(history: string): string {
  // eslint-disable-next-line no-control-regex
  const text = history.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  const lines = text.trimEnd().split("\n").slice(-HISTORY_LINES);
  if (!lines.length || (lines.length === 1 && lines[0] === "")) return "";
  return lines.join("\r\n") + "\r\n\x1b[2m── restored ──\x1b[0m\r\n";
}

interface BufferLike {
  type: "normal" | "alternate";
  length: number;
  baseY: number;
  getLine(y: number): { isWrapped: boolean; translateToString(trimRight?: boolean): string } | undefined;
}
interface TermLike {
  rows: number;
  buffer: { active: BufferLike };
}

/** A pane's text, scrollback and screen (the last HISTORY_LINES lines), plain. A full-screen app gives its screen. */
export function historyText(term: TermLike): string {
  const b = term.buffer.active;
  const from = b.type === "alternate" ? b.baseY : 0;
  const to = b.type === "alternate" ? b.baseY + term.rows : b.length;
  const lines: string[] = [];
  for (let y = from; y < to; y++) {
    const line = b.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.join("\n").trimEnd().split("\n").slice(-HISTORY_LINES).join("\n");
}

const RESUME = /^(claude:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|codex|opencode)$/;

/** A saved tree (from session.json), checked: unknown characters and root shells come back as Madoka, odd ratios as
 * halves, resume values only if they're one of the known forms. null if it's not a tree. */
export function readTree(v: unknown): SavedNode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === "string" ? x : undefined);
  if ("char" in o) {
    const c = str(o.char);
    const char = c && c !== "kyubey" && characterNamed(c) ? (c as CharName) : "madoka";
    const resume = str(o.resume) ?? (str(o.claude) ? `claude:${o.claude}` : undefined);
    return { kind: "pane", char, cwd: str(o.cwd), text: str(o.text), resume: resume && RESUME.test(resume) ? resume : undefined };
  }
  if (o.orient !== "h" && o.orient !== "v") return null;
  const a = readTree(o.a), b = readTree(o.b);
  if (!a || !b) return null;
  const r = typeof o.ratio === "number" && o.ratio > 0 && o.ratio < 1 ? o.ratio : 0.5;
  return { kind: "split", orient: o.orient, ratio: r, a, b };
}
