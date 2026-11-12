// The notepad's markup: <head>Title<head> (or </head>) headers and *bold* words. Tags are hidden except where the
// cursor is.
export interface Mark {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}

const HEAD = /<head>([^\n]+?)<\/?head>/g;
// *bold*, not "* bullet" or 2*3*4
const BOLD = /(?<![\p{L}\p{N}_*])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?![\p{L}\p{N}_*])/gu;

function marks(text: string, re: RegExp, open: number): Mark[] {
  return [...text.matchAll(re)].map((m) => {
    const start = m.index!, innerStart = start + open;
    return { start, end: start + m[0].length, innerStart, innerEnd: innerStart + m[1].length };
  });
}

export function noteMarks(text: string): { heads: Mark[]; bolds: Mark[] } {
  return { heads: marks(text, HEAD, 6), bolds: marks(text, BOLD, 1) };
}

/** The marks whose tags show: those the cursor is in or right next to. */
export function visibleTags(m: { heads: Mark[]; bolds: Mark[] }, cursor: number): Mark[] {
  return [...m.heads, ...m.bolds].filter((x) => x.start <= cursor && cursor <= x.end).sort((a, b) => a.start - b.start);
}

/** Where the n-th header starts (to jump there). */
export function headerAt(heads: Mark[], n: number): number {
  return heads[n]?.start ?? 0;
}
