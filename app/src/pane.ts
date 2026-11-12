// A pane: her terminal (xterm.js, transparent) over a plain background, her figure between them, and whatever opens
// over it (the game, the notepad, `space`, the search bar).
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { characterNamed, type CharName } from "./characters";
import { openCrush } from "./crush/view";
import { Figure } from "./figure";
import { killPane, pathExists, resizePane, spawnPane, writePane } from "./ipc";
import { findLinks, linkUrl, resolvePath } from "./links";
import { openNotes } from "./notes/view";
import type { Overlay, PaneHost } from "./overlay";
import { install, type MagicaCmd } from "./protocol";
import { openSpace } from "./space";
import { historyText, restoredText } from "./session";
import type { Settings } from "./settings";
import { mix, palette, THEMES, xtermTheme, type ThemeName } from "./theme";
import { actionFor } from "./keys";

export interface WindowHost {
  settings: Settings;
  os: "linux" | "mac" | "windows";
  home: string;
  theme(): ThemeName;
  fontFamily(): string;
  fontSize(): number;
  isActive(pane: Pane): boolean;
  focusChanged(pane: Pane): void;
  titleChanged(pane: Pane): void;
  applyLayout(pane: Pane, name: "pair" | "magica"): void;
  paneExited(pane: Pane): void;
  overlaysChanged(): void;
  notify(title: string, body: string): void;
  multi(pane: Pane): boolean;   // several panes in its tab
}

export interface PaneOpts {
  character: CharName;
  cwd?: string;
  command?: string[];
  text?: string;      // a restored pane's old text
  resume?: string;    // …or its coding agent to start again
}

let nextId = 1;

export class Pane implements PaneHost {
  readonly id = nextId++;
  readonly el = document.createElement("div");
  readonly term: Terminal;
  readonly settings: Settings;
  character: CharName;
  cwd: string;
  where: string;            // her folder as the prompt shows it (title bar)
  focused = false;
  overlay: Overlay | null = null;
  private ptyId = 0;
  private fit = new FitAddon();
  private search = new SearchAddon();
  private figure: Figure;
  private searchBar: HTMLInputElement | null = null;
  private cmdStart: number | null = null;
  private protocol: { themeChanged(): void };
  private exited = false;
  private resizeObserver: ResizeObserver;

  constructor(private win: WindowHost, opts: PaneOpts) {
    this.settings = win.settings;
    this.character = opts.character;
    this.cwd = opts.cwd ?? win.home;
    this.where = this.homePath(this.cwd);
    this.el.className = "pane";
    const back = document.createElement("div");
    back.className = "pane-bg";
    const host = document.createElement("div");
    host.className = "term";
    host.style.padding = `${this.settings.padding}px`;
    this.figure = new Figure({
      settings: this.settings,
      name: () => this.character,
      colour: () => this.colour(),
      focused: () => this.focused,
      hidden: () => this.overlay?.kind === "crush" || this.overlay?.kind === "note",
      term: () => this.term,
      inkColours: () => ({ fg: THEMES[win.theme()].fg, bg: THEMES[win.theme()].bg, palette: palette(win.theme(), this.settings) }),
      padding: () => this.settings.padding,
    }, this.el);
    this.el.append(back, this.figure.canvas, this.figure.base, host);

    this.term = new Terminal({
      allowTransparency: true,
      allowProposedApi: true,
      fontFamily: win.fontFamily(),
      fontSize: win.fontSize(),
      scrollback: 10000,
      cursorBlink: false,
      macOptionIsMeta: true,
      theme: xtermTheme(win.theme(), this.colour(), false, this.settings),
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.search);
    const unicode = new Unicode11Addon();
    this.term.loadAddon(unicode);
    this.term.unicode.activeVersion = "11";
    this.term.open(host);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      this.term.loadAddon(gl);
    } catch { /* no WebGL here (some WebKitGTK setups): xterm's own renderer is fine */ }
    // the window's shortcuts aren't the program's; everything else is
    this.term.attachCustomKeyEventHandler((e) => actionFor(e, win.os === "mac" ? "mac" : "other") === null);
    this.term.options.linkHandler = { activate: (e, uri) => this.clicked(e) && openUrl(uri).catch(() => {}), allowNonHttpProtocols: true };
    this.term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = this.term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        callback(findLinks(line).map((l) => ({
          range: { start: { x: l.start + 1, y }, end: { x: l.end, y } },
          text: l.text,
          activate: (e: MouseEvent) => this.clicked(e) && this.open(l.text, l.kind),
        })));
      },
    });

    this.protocol = install(this.term, {
      onMagica: (c) => this.onMagica(c),
      onCwd: (p) => {
        this.cwd = p;
      },
      onMark: (m) => {
        if (m.kind === "exec") this.cmdStart = performance.now();
        else if (m.kind === "done") {
          if (this.cmdStart === null) return;   // an empty line: nothing ran
          const took = (performance.now() - this.cmdStart) / 1000;
          this.cmdStart = null;
          this.figure.onCommandDone(m.exit, took, this.focused && document.hasFocus(), (body) =>
            win.notify(this.character[0].toUpperCase() + this.character.slice(1), body));
        }
      },
      onTitle: (t) => {
        const m = t.match(/^\w+@magica: (.*)$/);   // the prompt's title: her folder, as the prompt shows it
        if (m) {
          this.where = m[1];
          win.titleChanged(this);
        }
      },
      reply: (s) => this.ptyId && writePane(this.ptyId, s),
      theme: () => ({ fg: THEMES[win.theme()].fg, bg: THEMES[win.theme()].bg, dark: win.theme() === "dark" }),
    });

    this.term.onData((d) => {
      this.figure.touch();
      if (this.ptyId) writePane(this.ptyId, d);
    });
    this.term.onBinary((d) => this.ptyId && writePane(this.ptyId, d));
    this.term.onResize(({ cols, rows }) => {
      if (this.ptyId) resizePane(this.ptyId, cols, rows);
      this.figure.queueCover();
    });
    this.term.onWriteParsed(() => {
      this.figure.touch();
      this.figure.queueCover();
    });
    this.term.textarea?.addEventListener("focus", () => this.setFocused(true));
    this.term.textarea?.addEventListener("blur", () => this.setFocused(false));
    this.el.addEventListener("mousedown", () => win.focusChanged(this));

    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(this.el);
    if (opts.text) this.term.write(restoredText(opts.text));
    this.restyle();
    this.start(opts);
  }

  private clicked(e: MouseEvent): boolean {
    return this.win.os === "mac" ? e.metaKey : e.ctrlKey;
  }

  private async open(text: string, kind: "url" | "path") {
    if (kind === "url") return openUrl(linkUrl(text)).catch(() => {});
    const p = resolvePath(text, this.win.home, this.cwd);
    if (await pathExists(p)) openPath(p).catch(() => {});
  }

  private async start(opts: PaneOpts) {
    requestAnimationFrame(() => this.layout());
    await new Promise((r) => requestAnimationFrame(r));
    try {
      this.ptyId = await spawnPane(
        { cwd: opts.cwd, character: this.character, command: opts.command, resume: opts.resume, cols: this.term.cols, rows: this.term.rows },
        (b) => this.term.write(b),
        () => {
          this.exited = true;
          this.ptyId = 0;
          this.win.paneExited(this);
        },
      );
      resizePane(this.ptyId, this.term.cols, this.term.rows);
    } catch (e) {
      this.term.write(`\r\nmagica: couldn't start a shell: ${e}\r\n`);
    }
  }

  // ── PaneHost (for overlays) ──
  theme(): ThemeName {
    return this.win.theme();
  }
  colour(): string {
    const c = characterNamed(this.character)!;
    return this.win.theme() === "dark" ? c.dark : c.light;
  }
  fontFamily(): string {
    return this.win.fontFamily();
  }
  shellKind(): "posix" | "pwsh" {
    return this.win.os === "windows" ? "pwsh" : "posix";
  }
  sendToShell(text: string) {
    if (this.ptyId) writePane(this.ptyId, text);
  }
  closeOverlay() {
    if (!this.overlay) return;
    const o = this.overlay;
    this.overlay = null;
    o.dispose();
    o.el.remove();
    this.figure.update();
    this.win.overlaysChanged();
    this.term.focus();
  }

  private openOverlay(o: Overlay) {
    this.closeOverlay();
    this.closeSearch();
    this.overlay = o;
    this.el.append(o.el);
    this.figure.update();
    this.win.overlaysChanged();
    requestAnimationFrame(() => o.focus());
  }

  openCrush() {
    this.openOverlay(openCrush(this));
  }
  openNotes() {
    this.openOverlay(openNotes(this));
  }
  openSpace(path: string) {
    this.openOverlay(openSpace(this, path || this.cwd, this.win.home));
  }

  private onMagica(c: MagicaCmd) {
    if (c.verb === "set") this.setCharacter(c.name);
    else if (c.verb === "layout") this.win.applyLayout(this, c.name);
    else if (c.verb === "crush") this.openCrush();
    else if (c.verb === "note") this.openNotes();
    else if (c.verb === "space") this.openSpace(c.path);
  }

  setCharacter(name: CharName) {
    this.character = name;
    this.figure.load();
    this.restyle();
    this.win.titleChanged(this);
  }

  // ── focus and looks ──
  setFocused(on: boolean) {
    if (on === this.focused) return;
    this.focused = on;
    if (on) this.win.focusChanged(this);
    this.restyle();
  }

  focus() {
    if (this.overlay) this.overlay.focus();
    else if (this.searchBar) this.searchBar.focus();
    else this.term.focus();
  }

  restyle() {
    const s = this.settings, theme = this.win.theme(), t = THEMES[theme];
    const active = this.win.isActive(this);
    this.term.options.theme = xtermTheme(theme, this.colour(), active, s);
    const multi = this.win.multi(this);
    // with several panes: the focused one gets a light tint of her colour; the others an optional veil
    const bg = multi && active ? mix(mix(t.bg, "#ffffff", s.focus_brighten[theme]), this.colour(), s.focus_tint) : t.bg;
    this.el.style.setProperty("--pane-bg", bg);
    this.el.style.setProperty("--her", this.colour());
    this.el.style.setProperty("--veil", multi && !active ? s.unfocused_overlay : "transparent");
    this.el.style.setProperty("--frame", multi && active ? this.colour() : "transparent");
    this.el.style.setProperty("--frame-width", `${s.frame_width}px`);
    this.figure.update();
    this.overlay?.restyle?.();
  }

  themeChanged() {
    this.restyle();
    this.protocol.themeChanged();
  }

  setFont(family: string, size: number) {
    this.term.options.fontFamily = family;
    this.term.options.fontSize = size;
    this.layout();
    this.overlay?.restyle?.();
  }

  layout() {
    if (!this.el.isConnected || this.el.clientWidth < 2) return;
    try {
      this.fit.fit();
    } catch { /* not laid out yet */ }
    this.figure.update();
  }

  // ── search (Enter older, Shift+Enter newer, Esc closes) ──
  openSearch() {
    if (this.overlay) return;
    if (this.searchBar) return this.searchBar.focus();
    const input = document.createElement("input");
    input.className = "search";
    input.placeholder = "search";
    input.spellcheck = false;
    const opts = { decorations: { matchOverviewRuler: "#888", activeMatchColorOverviewRuler: this.colour(), activeMatchBackground: this.colour() } };
    input.addEventListener("input", () => this.search.findPrevious(input.value, { ...opts, incremental: true }));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeSearch();
      else if (e.key === "Enter") e.shiftKey ? this.search.findNext(input.value, opts) : this.search.findPrevious(input.value, opts);
      else return;
      e.preventDefault();
    });
    this.searchBar = input;
    this.el.append(input);
    input.focus();
  }

  closeSearch() {
    if (!this.searchBar) return;
    this.searchBar.remove();
    this.searchBar = null;
    this.search.clearDecorations();
    this.term.focus();
  }

  /** Close what's over the terminal (search, game, notepad, space); false if there was nothing. */
  closeTop(): boolean {
    if (this.searchBar) return this.closeSearch(), true;
    if (this.overlay) return this.closeOverlay(), true;
    return false;
  }

  hasSearch(): boolean {
    return !!this.searchBar;
  }

  copy(): string {
    return this.term.getSelection();
  }

  paste(text: string) {
    this.term.paste(text);
  }

  // ── session ──
  history(): string {
    return historyText(this.term);
  }

  get ptyIdForSession(): number {
    return this.ptyId;
  }

  homePath(p: string): string {
    const h = this.win.home;
    return h && (p === h || p.startsWith(h + "/") || p.startsWith(h + "\\")) ? "~" + p.slice(h.length) : p;
  }

  dispose() {
    this.closeOverlay();
    this.figure.dispose();
    this.resizeObserver.disconnect();
    if (this.ptyId && !this.exited) killPane(this.ptyId).catch(() => {});
    this.term.dispose();
    this.el.remove();
  }
}
