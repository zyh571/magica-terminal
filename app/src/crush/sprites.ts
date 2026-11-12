// Magica Crush's pixel art: the five soul gems (an egg in a gold crown and cup), Kyubey (the bomb) and a 3x5 font.
// Ported from the old app; the gems come out pixel for pixel the same.

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];
export type Px = Rgba[][];

export const CELL = 20;   // art pixels per board cell
export const GEM_COLOURS = ["#ff6eb0", "#9a6bff", "#4f9dff", "#ffe94d", "#e3203a"];
const GEM_METAL: Record<string, string> = { G: "#e9b949", g: "#9b6a17", Y: "#fff0a6" };   // gold, its shadow and shine
const GEM_CROWN = ["....YY....", "...gGGg...", ".gGGYYGGg.", "gGYGGGGYGg", "g.G.gg.G.g"];
const GEM_CUP = ["g.G....G.g", "gGGGYYGGGg", ".gGGGGGGg.", "..gGYYGg.."];
const KYUBEY_SPRITE = [
  "..................",
  ".WW............WW.",
  ".WWW..........WWW.",
  "..WWWWWWWWWWWWWW..",
  "..WWWWWWWWWWWWWW..",
  ".WWWWWWWWWWWWWWWW.",
  ".WWWWWWWWWWWWWWWW.",
  ".WWWRRWWWWWWRRWWW.",
  ".WWWRRWWWWWWRRWWW.",
  ".WWWWWWWWWWWWWWWW.",
  ".WWWWWWWPPWWWWWWW.",
  "..WWWWWWWWWWWWWW..",
  "..PWWWWWWWWWWWWP..",
  ".PW.WWWWWWWWWW.WP.",
  ".W...WWWWWWWW...W.",
  ".W..............W.",
  ".P..............P.",
  "..................",
];
export const FONT_3X5: Record<string, string> = {
  "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
  "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001010010010",
  "8": "111101111101111", "9": "111101111001111", A: "010101111101101", B: "110101110101110",
  C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "011100101101011", H: "101101111101101", I: "111010010010111", K: "101101110101101",
  L: "100100100100111", M: "101111111101101", N: "110101101101101", O: "010101101101010",
  P: "110101110100100", Q: "010101101110011", R: "110101110101101", S: "011100010001110",
  T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101",
  X: "101101010101101", Y: "101101010010010", Z: "111001010100111", "!": "010010010000010", "+": "000010111010000",
  "-": "000000111000000", ":": "000010000010000", " ": "000000000000000",
};

/** Python's round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const f = Math.floor(x), d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

const shade = (a: Rgb, b: Rgb, t: number): Rgb => a.map((x, i) => pyRound(x + (b[i] - x) * t)) as Rgb;
const blank = (): Px => Array.from({ length: CELL }, () => Array.from({ length: CELL }, () => [0, 0, 0, 0] as Rgba));

/** A 1-pixel outline around the opaque pixels. */
export function outline(px: Px, colour: Rgb): Px {
  const h = px.length, w = px[0].length;
  const out = px.map((row) => row.map((p) => [...p] as Rgba));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y][x][3] !== 0) continue;
      const touches = [[0, 1], [1, 0], [0, -1], [-1, 0]].some(([dy, dx]) => {
        const yy = y + dy, xx = x + dx;
        return yy >= 0 && yy < h && xx >= 0 && xx < w && px[yy][xx][3];
      });
      if (touches) out[y][x] = [...colour, 255];
    }
  }
  return out;
}

/** Her soul gem as a CELL x CELL sprite: an egg lit from the top-left (a facet, a glint, an outline) in its gold
 * crown and cup. Striped gems get light bands, wrapped ones are brighter; both are outlined in a light shade. */
export function gemPixels(kind: number, special: string | null): Px {
  const c = rgb(GEM_COLOURS[kind]), white: Rgb = [255, 255, 255], black: Rgb = [0, 0, 0];
  const tones = [shade(c, white, 0.6), shade(c, white, 0.25), c, shade(c, black, 0.3), shade(c, black, 0.5)];
  let px = blank();
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const u = (x + 0.5 - CELL / 2) / 5.0, v = (y + 0.5 - 10) / 5.8;
      if ((u / (1 - 0.15 * Math.max(0, -v))) ** 2 + v * v <= 1) {   // an egg, narrower at the top
        const light = 0.55 * u + 0.7 * v - 0.25 * (1 - (u * u + v * v));
        let tone = tones[[-0.55, -0.2, 0.2, 0.5].filter((t) => light >= t).length];
        if ((special === "h" || special === "v") && Math.floor((special === "h" ? y : x) / 2) % 2 === 0) {
          tone = shade(tone, white, 0.55);
        } else if (special === "wrapped" || special === "armed") {
          tone = shade(tone, white, 0.25);
        }
        px[y][x] = [...tone, 255];
      }
    }
  }
  for (let d = -1; d < 3; d++) {   // a facet: a lighter diagonal through the middle
    const p = px[10 - d][10 + d];
    if (p[3]) px[10 - d][10 + d] = [...shade([p[0], p[1], p[2]], white, 0.35), 255];
  }
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) px[7 + dy][7 + dx] = [255, 255, 255, 255];   // the glint
  px = outline(px, special === null ? shade(c, black, 0.72) : shade(c, white, 0.3));
  for (const [rows, top] of [[GEM_CROWN, 1], [GEM_CUP, CELL - 1 - GEM_CUP.length]] as [string[], number][]) {
    rows.forEach((row, i) => {
      [...row].forEach((ch, j) => {
        if (GEM_METAL[ch]) px[top + i][Math.floor((CELL - row.length) / 2) + j] = [...rgb(GEM_METAL[ch]), 255];
      });
    });
  }
  return px;
}

export function kyubeyPixels(): Px {
  const colours: Record<string, Rgb> = { W: [246, 246, 248], R: [214, 33, 59], P: [242, 140, 177] };
  const px = blank();
  KYUBEY_SPRITE.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (colours[ch]) px[y + 1][x + 1] = [...colours[ch], 255];
    });
  });
  return px;
}

/** A sprite as a canvas, to draw scaled with nearest-neighbour filtering. */
export function spriteCanvas(px: Px): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = px[0].length;
  c.height = px.length;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(c.width, c.height);
  px.flat().forEach((p, i) => img.data.set(p, i * 4));
  ctx.putImageData(img, 0, 0);
  return c;
}
