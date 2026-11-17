// Ctrl+click (Cmd+click on macOS) opens links and file paths in a pane's text. Programs' own OSC 8 hyperlinks work too.
export interface Link {
  start: number;   // index into the line's text
  end: number;
  text: string;
  kind: "url" | "path";
}

const W = "\\p{L}\\p{N}_";
const URLS = [
  /\b(?:https?|ftp|file):\/\/[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]/gu,
  /\bwww\.[\p{L}\p{N}_-]+\.[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]/gu,
];
// an absolute or ~ path, not ending in "." (the end of a sentence); only opened if it exists
const PATHS = [
  new RegExp(`(?<![${W}/\\\\~.:-])~?(?:/[${W}.+@%-]*[${W}+@%-])+/?`, "gu"),
  // Windows: after a drive letter (C:\x, C:/x, D:\) or ~\ (so a lone backslash, as in \section, isn't one)
  new RegExp(`(?<![${W}/\\\\~.:-])(?:[A-Za-z]:|~(?=\\\\))(?:[\\\\/][${W}.+@%-]*[${W}+@%-])*[\\\\/]?`, "gu"),
];

export function findLinks(line: string): Link[] {
  const found: Link[] = [];
  for (const re of URLS) {
    for (const m of line.matchAll(re)) found.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], kind: "url" });
  }
  for (const re of PATHS) {
    for (const m of line.matchAll(re)) {
      const start = m.index!, end = start + m[0].length;
      if (/^[A-Za-z]:$/.test(m[0])) continue;   // a bare "C:" (no separator after it) isn't a path
      if (!found.some((l) => start < l.end && end > l.start)) found.push({ start, end, text: m[0], kind: "path" });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** A path as typed (~ for home) made absolute. */
export function resolvePath(p: string, home: string, cwd: string): string {
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) return home + p.slice(1);
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return p;
  return `${cwd}/${p}`;
}

/** A www. link needs a scheme to open. */
export function linkUrl(text: string): string {
  return /^www\./.test(text) ? `https://${text}` : text;
}
