// Her soul gem in light, her witch's grief seed in dark (public/gems; Kyubey is his pixel sprite in both): for the
// title bar and the taskbar icon. Grief seeds are all black and silver, so each one's silver takes her witch's colour
// and she glows in it.
import { characterNamed, type CharName } from "./characters";
import { kyubeyPixels, outline, spriteCanvas } from "./crush/sprites";
import { hexRgb, mix, THEMES, type ThemeName } from "./theme";

// Corrections from each source seed's alpha-weighted principal axis to the shared 58-degree taskbar angle.
const SEED_TURN: Partial<Record<CharName, number>> = {
  madoka: 1.3, homura: 0.3, sayaka: 4.6, mami: -1.3, kyoko: -1.3,
};

/** The stable, muted backing for her taskbar icon. It deliberately uses her light-side colour in both themes. */
export function taskbarIconBackground(name: CharName): string {
  if (name === "kyubey") return "#7a7a80";
  return mix(characterNamed(name)!.light, THEMES.light.bg, 0.62);
}

export function taskbarSeedTurn(name: CharName): number {
  return SEED_TURN[name] ?? 0;
}

/** Her picture's URL, or null for Kyubey (who has no gem). */
export function gemUrl(name: CharName, theme: ThemeName): string | null {
  return name === "kyubey" ? null : `/gems/${theme === "dark" ? "seed" : "gem"}-${name}.png`;
}

/** A grief seed's silver toward `colour`: light pixels take her colour, black stays black. Brightness is measured
 * against the seed's own brightest metal (its 98th percentile), so a dark one (Kriemhild's, from the anime) glows as
 * much as the bright game renders. */
export function tintPixels(data: Uint8ClampedArray, colour: string, amount = 0.7): void {
  const [cr, cg, cb] = hexRgb(colour);
  const lum = (i: number) => (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255;
  const hist = new Array<number>(256).fill(0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { hist[Math.round(lum(i) * 255)]++; n++; }
  let top = 255;
  for (let seen = 0; top > 0 && (seen += hist[top]) < n * 0.02; top--);
  const scale = 1 / Math.max(0.2, top / 255);
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const k = Math.min(1, lum(i) * scale);
    data[i] += (cr * k - data[i]) * amount;
    data[i + 1] += (cg * k - data[i + 1]) * amount;
    data[i + 2] += (cb * k - data[i + 2]) * amount;
  }
}

function load(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img);
}

/** Her picture in a size x size canvas, centred: a seed tinted and glowing in `colour`, a gem as it is. */
async function picture(name: CharName, theme: ThemeName, colour: string, size: number): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const url = gemUrl(name, theme);
  if (!url) {   // Kyubey: whole pixels
    const sp = spriteCanvas(outline(kyubeyPixels(), [40, 36, 48]));
    const k = Math.max(1, Math.floor(size / sp.width)), d = sp.width * k;
    g.imageSmoothingEnabled = false;
    g.drawImage(sp, Math.floor((size - d) / 2), Math.floor((size - d) / 2), d, d);
    return c;
  }
  const img = await load(url);
  const seed = theme === "dark", room = seed ? 0.86 : 1;   // (a seed leaves room for its glow)
  const k = (size * room) / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const art = document.createElement("canvas");
  art.width = w;
  art.height = h;
  const a = art.getContext("2d")!;
  a.imageSmoothingQuality = "high";
  a.drawImage(img, 0, 0, w, h);
  if (seed) {
    const px = a.getImageData(0, 0, w, h);
    tintPixels(px.data, colour);
    a.putImageData(px, 0, 0);
    g.shadowColor = colour;
    g.shadowBlur = size * 0.07;
  }
  g.drawImage(art, Math.round((size - w) / 2), Math.round((size - h) / 2));
  return c;
}

/** Her picture for the title bar: a canvas drawn at the screen's pixel density once the image has loaded. */
export function gemElement(name: CharName, theme: ThemeName, colour: string, cssSize: number): HTMLCanvasElement {
  const shown = document.createElement("canvas");
  shown.style.width = shown.style.height = `${cssSize}px`;
  const size = Math.round(cssSize * (window.devicePixelRatio || 1));
  shown.width = shown.height = size;
  picture(name, theme, colour, size).then((p) => shown.getContext("2d")!.drawImage(p, 0, 0)).catch(() => {});
  return shown;
}

/** Her picture on its muted character circle as size x size RGBA, for the taskbar. */
export async function gemIcon(name: CharName, theme: ThemeName, colour: string, size: number): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const centre = size / 2, diameter = size * 0.96;
  g.fillStyle = taskbarIconBackground(name);
  g.beginPath();
  g.arc(centre, centre, diameter / 2, 0, Math.PI * 2);
  g.fill();

  if (name === "kyubey") {
    const sp = spriteCanvas(outline(kyubeyPixels(), [40, 36, 48]));
    const d = diameter * 0.82;
    g.imageSmoothingEnabled = false;
    g.drawImage(sp, centre - d / 2, centre - d / 2, d, d);
  } else {
    const seed = theme === "dark";
    const img = await load(gemUrl(name, theme)!);
    // Gems sit upright across the horizontal diameter. A seed's complete source-canvas diagonal spans the circle's
    // diameter, so its finial and spike remain visible after the small rotation that normalises all five to 58°.
    const h = seed
      ? diameter * img.naturalHeight / Math.hypot(img.naturalWidth, img.naturalHeight)
      : diameter * 0.82;
    const w = h * img.naturalWidth / img.naturalHeight;
    const art = document.createElement("canvas");
    art.width = Math.max(1, Math.round(w));
    art.height = Math.max(1, Math.round(h));
    const a = art.getContext("2d")!;
    a.imageSmoothingQuality = "high";
    a.drawImage(img, 0, 0, art.width, art.height);
    if (seed) {
      const px = a.getImageData(0, 0, art.width, art.height);
      tintPixels(px.data, colour);
      a.putImageData(px, 0, 0);
      g.shadowColor = colour;
      g.shadowBlur = size * 0.045;
    }
    g.save();
    g.translate(centre, centre);
    if (seed) g.rotate(taskbarSeedTurn(name) * Math.PI / 180);
    g.drawImage(art, -art.width / 2, -art.height / 2);
    g.restore();
  }
  return new Uint8Array(c.getContext("2d")!.getImageData(0, 0, size, size).data.buffer);
}
