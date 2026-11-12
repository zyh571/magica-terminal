// Her figure behind a pane's text: placement, the bar under her, the reactions (a jump on success, a red squash on a
// failure, three hops when a long command finishes unwatched, idle bobs and breaths), and fading while the mouse or
// text is in front of her.
import type { Terminal } from "@xterm/xterm";
import { breathAt, coverFraction, figureBox, hopOffset, lineInks, solidSpans, squashAt } from "./cover";
import type { Settings } from "./settings";
import { mix } from "./theme";

export interface FigureHost {
  settings: Settings;
  name(): string;
  colour(): string;
  focused(): boolean;
  hidden(): boolean;   // the game or notepad covers the pane
  term(): Terminal;
  inkColours(): { fg: string; bg: string; palette: string[] };
  padding(): number;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
function image(name: string): Promise<HTMLImageElement | null> {
  if (!images.has(name)) {
    images.set(name, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);   // (no kyubey.png: Kyubey shows no figure)
      img.src = `/figures/${name}.png`;
    }));
  }
  return images.get(name)!;
}

export class Figure {
  readonly canvas = document.createElement("canvas");
  readonly base = document.createElement("div");
  private img: HTMLImageElement | null = null;
  private loadedName = "";
  private stretch = 1;
  private widen = 1;
  private hop = 0;
  private failing = false;
  private hovering = false;
  private cover = 0;
  private hopping = false;
  private breathing = false;
  private squashId = 0;
  private failId = 0;
  private lastActivity = performance.now();
  private idleTimer = 0;
  private coverTimer = 0;
  private spans: ([number, number] | null)[] = [];
  private spansKey = "";
  private disposed = false;

  constructor(private host: FigureHost, private pane: HTMLElement) {
    this.canvas.className = "figure";
    this.base.className = "figure-base";
    pane.addEventListener("pointermove", (e) => this.setHover(this.over(e)));
    pane.addEventListener("pointerleave", () => this.setHover(false));
    this.scheduleIdle();
    this.load();
  }

  private over(e: PointerEvent): boolean {
    const r = this.canvas.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom;
  }

  async load() {
    const name = this.host.name();
    if (name === this.loadedName) return this.update();
    this.loadedName = name;
    const img = await image(name);
    if (this.loadedName !== name) return;
    this.img = img;
    this.update();
  }

  touch() {
    this.lastActivity = performance.now();
  }

  /** Redraw her for the pane's current size and state. */
  update() {
    if (this.disposed) return;
    const s = this.host.settings;
    const w = this.pane.clientWidth, h = this.pane.clientHeight;
    const show = !!this.img && !this.host.hidden() && w > 1 && h > 1;
    this.canvas.hidden = !show;
    this.base.hidden = true;
    if (!show) return;
    const img = this.img!;
    const box = figureBox(w, h, img.naturalWidth, img.naturalHeight, s, this.host.name(), { stretch: this.stretch, widen: this.widen, hop: this.hop });
    const dpr = window.devicePixelRatio || 1;
    const red = s.fail_red;
    const key = `${this.loadedName}|${box.w}|${box.h}|${this.failing}|${red}|${dpr}`;
    if (key !== this.spansKey) {
      this.spansKey = key;
      this.canvas.width = Math.max(1, Math.round(box.w * dpr));
      this.canvas.height = Math.max(1, Math.round(box.h * dpr));
      const g = this.canvas.getContext("2d", { willReadFrequently: true })!;
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
      if (this.failing) {   // tinted red (her shape only)
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = s.fail_tint;
        g.fillStyle = red;
        g.fillRect(0, 0, this.canvas.width, this.canvas.height);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
      }
      if (s.text_opacity < 1) {
        const data = g.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
        this.spans = solidSpans(data, this.canvas.width, this.canvas.height);
      }
    }
    Object.assign(this.canvas.style, { width: `${box.w}px`, height: `${box.h}px`, right: `${box.right}px`, bottom: `${box.bottom}px` });
    // only under the focused pane's figure, or any pane's while a failure flashes
    const baseOn = s.base_height > 0 && (this.host.focused() || this.failing);
    this.base.hidden = !baseOn;
    if (baseOn) {
      Object.assign(this.base.style, {
        width: `${box.baseW}px`, height: `${box.baseH}px`, right: `${box.baseRight}px`, bottom: `${box.baseBottom}px`,
        background: this.failing ? mix(this.host.colour(), red, s.fail_tint) : this.host.colour(),
      });
    }
    this.updateOpacity();
    this.queueCover();
  }

  private updateOpacity() {
    const s = this.host.settings;
    const op = s.figure_opacity * (this.hovering ? s.hover_opacity : 1 - (1 - s.text_opacity) * Math.min(1, this.cover / Math.max(s.text_full, 0.01)));
    this.canvas.style.opacity = String(op);
    this.base.style.opacity = String(op);
  }

  setHover(on: boolean) {
    if (on !== this.hovering) {
      this.hovering = on;
      this.updateOpacity();
    }
  }

  // ── fading while there's text behind her (at most every 100 ms, however fast the output) ──
  queueCover() {
    if (this.host.settings.text_opacity >= 1 || this.coverTimer) return;
    this.coverTimer = window.setTimeout(() => {
      this.coverTimer = 0;
      this.checkCover();
    }, 100);
  }

  private checkCover() {
    if (this.canvas.hidden || !this.spans.length) return;
    const term = this.host.term();
    const core = (term as unknown as { _core?: { _renderService?: { dimensions?: { css: { cell: { width: number; height: number } } } } } })._core;
    const cell = core?._renderService?.dimensions?.css.cell;
    if (!cell || !term.element) return;
    const dpr = window.devicePixelRatio || 1;
    const fr = this.canvas.getBoundingClientRect(), screen = term.element.querySelector(".xterm-screen")?.getBoundingClientRect();
    if (!screen) return;
    const k = this.host.inkColours();
    const buf = term.buffer.active;
    const contrast = this.host.settings.text_contrast;
    const lines = new Map<number, boolean[]>();
    const spans = this.spans.map((sp) => (sp ? [sp[0] / dpr, sp[1] / dpr] as [number, number] : null));
    const rows: ([number, number] | null)[] = [];
    // one span per CSS pixel row
    for (let y = 0; y < Math.round(fr.height); y++) rows.push(spans[Math.min(spans.length - 1, Math.floor(y * dpr))] ?? null);
    const cover = coverFraction(rows, { x: fr.left - screen.left, y: fr.top - screen.top }, { w: cell.width, h: cell.height, cols: term.cols, rows: term.rows }, (r, c) => {
      if (!lines.has(r)) {
        const line = buf.getLine(buf.viewportY + r);
        lines.set(r, line ? lineInks(line, 0, term.cols, { ...k, contrast }) : []);
      }
      return lines.get(r)![c] ?? false;
    });
    if (Math.abs(cover - this.cover) > 0.005) {
      this.cover = cover;
      this.updateOpacity();
    }
  }

  // ── reactions ──
  /** A command finished (OSC 133;D): `took` seconds; `watched`: its pane is focused in the active window. */
  onCommandDone(exit: number, took: number, watched: boolean, notify: (body: string) => void) {
    const s = this.host.settings;
    if (exit && !s.ignored_exit.includes(exit) && s.fail_flash) this.flashFailure();
    if (s.long_command && took >= s.long_command && !watched) {
      this.doHop(s.hop_height, s.hops);
      if (s.notify && !document.hasFocus()) {
        const mins = Math.floor(Math.round(took) / 60), secs = Math.round(took) % 60;
        notify(`finished after ${mins ? `${mins}m ${secs}s` : `${secs}s`}${exit ? ` (exit ${exit})` : ""}`);
      }
    } else if (exit === 0 && s.jump_height) this.doHop(s.jump_height, 1);
  }

  private animate(length: number, frame: (t: number) => boolean | void, done?: () => void) {
    const start = performance.now();
    const step = () => {
      if (this.disposed) return;
      const t = (performance.now() - start) / 1000 / length;
      if (frame(Math.min(t, 1)) === false) return;
      this.update();
      if (t < 1) requestAnimationFrame(step);
      else done?.();
    };
    requestAnimationFrame(step);
  }

  flashFailure() {
    const s = this.host.settings;
    this.failing = true;
    const id = ++this.failId;
    setTimeout(() => {
      if (id === this.failId) {
        this.failing = false;
        this.update();
      }
    }, s.fail_flash * 1000);
    if (s.fail_squash) {
      const sid = ++this.squashId;
      this.animate(0.45, (t) => {
        if (sid !== this.squashId) return false;   // a newer squash took over
        ({ stretch: this.stretch, widen: this.widen } = squashAt(t, s.fail_squash));
      });
    }
    this.update();
  }

  doHop(height: number, hops: number) {
    if (this.hopping) return;
    this.hopping = true;
    this.animate(0.32 * hops, (t) => void (this.hop = hopOffset(t, height, hops)), () => {
      this.hop = 0;
      this.hopping = false;
      this.update();
    });
  }

  private breathe(length = 1.4) {
    this.breathing = true;
    this.animate(length, (t) => void (this.stretch = breathAt(t, this.host.settings.idle_breath)), () => {
      this.stretch = 1;
      this.breathing = false;
      this.update();
    });
  }

  private scheduleIdle() {
    const s = this.host.settings;
    if (!s.idle_after) return;
    const [a, b] = s.idle_every;
    this.idleTimer = window.setTimeout(() => {
      const quiet = performance.now() - this.lastActivity >= s.idle_after * 1000;
      if (quiet && !this.canvas.hidden && this.pane.isConnected && !this.hovering && !this.hopping && !this.breathing) {
        if (Math.random() < 0.5) this.doHop(s.idle_bob, 2);
        else this.breathe();
      }
      this.scheduleIdle();
    }, (a + Math.random() * (b - a)) * 1000);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.idleTimer);
    clearTimeout(this.coverTimer);
  }
}
