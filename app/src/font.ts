// The terminal font: loading the bundled Maple Mono and keeping xterm's cells as wide as its glyphs.

/** letterSpacing for xterm: it makes a cell floor(width × dpr) device pixels wide plus round(letterSpacing), so a
 * fractional width (Maple Mono at 11pt is 8.81px) would squeeze every glyph into a cell narrower than itself. */
export function cellSpacing(charWidth: number, dpr: number): number {
  const d = charWidth * dpr;
  return Math.ceil(d - 1e-3) - Math.floor(d) > 0 ? 1 : 0;
}

/** The advance of one cell in `size`px `family`, as xterm measures it (a run of W's). */
export function charWidth(family: string, size: number): number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${size}px ${family}`;
  return ctx.measureText("W".repeat(32)).width / 32;
}

const FACES: [file: string, weight: string, style: string][] = [
  ["MapleMono-Regular.ttf", "400", "normal"],
  ["MapleMono-Bold.ttf", "700", "normal"],
  ["MapleMono-Italic.ttf", "400", "italic"],
  ["MapleMono-BoldItalic.ttf", "700", "italic"],
];

/** Load the bundled Maple Mono before any terminal measures its font. Done here rather than by @font-face in the
 * stylesheet: a declared face only loads when asked after the stylesheet is in, and xterm measures once. */
export async function loadFonts(): Promise<void> {
  await Promise.all(FACES.map(async ([file, weight, style]) => {
    try {
      const face = new FontFace("Maple Mono", `url(/fonts/${file})`, { weight, style });
      document.fonts.add(await face.load());
    } catch { /* missing or broken: the next font in the stack is used */ }
  }));
}
