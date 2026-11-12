// The window: our own title bar (a dot and name@magica in the focused pane's colour, and her folder), tabs, each
// tab a tree of split panes, the shortcuts, the theme, the font size and the session.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readText as clipboardRead, writeText as clipboardWrite } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { nextCharacter, type CharName } from "./characters";
import { clearSession, paneResume, saveSession, writeText } from "./ipc";
import { actionFor, type Action } from "./keys";
import { build, LAYOUTS, neighbour, Node, paneIds, remove, split } from "./layout";
import { Pane, type PaneOpts, type WindowHost } from "./pane";
import { readTree, type SavedNode } from "./session";
import { parseFont, type Settings } from "./settings";
import { THEMES, type ThemeName } from "./theme";

interface Tab {
  root: Node;
  el: HTMLElement;
  label: HTMLElement;
}

export interface WindowOpts {
  settings: Settings;
  os: "linux" | "mac" | "windows";
  home: string;
  theme: ThemeName;
  themeSetting: "light" | "dark" | "system";
}

export class MagicaWindow implements WindowHost {
  readonly settings: Settings;
  readonly os: "linux" | "mac" | "windows";
  readonly home: string;
  private themeName: ThemeName;
  private tabs: Tab[] = [];
  private current = -1;
  private panes = new Map<number, Pane>();
  private active: Pane | null = null;
  private lastCharacter: CharName | undefined;
  private fontScale = 1;
  private font: { family: string; size: number };
  private onTop = false;
  private closing = false;
  private readonly appWindow = getCurrentWindow();
  private readonly titleWho: HTMLElement;
  private readonly titleWhere: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly stage: HTMLElement;

  constructor(private root: HTMLElement, o: WindowOpts) {
    this.settings = o.settings;
    this.os = o.os;
    this.home = o.home;
    this.themeName = o.theme;
    this.font = parseFont(o.settings.font);
    document.body.dataset.os = o.os;
    root.innerHTML = `
      <header class="titlebar" data-tauri-drag-region>
        <span class="dot"></span><span class="who" data-tauri-drag-region></span><span class="where" data-tauri-drag-region></span>
        <span class="buttons"><button class="min" title="Minimise">–</button><button class="max" title="Maximise">□</button><button class="close" title="Close">✕</button></span>
      </header>
      <nav class="tabs" hidden></nav>
      <main class="stage"></main>`;
    this.titleWho = root.querySelector(".who")!;
    this.titleWhere = root.querySelector(".where")!;
    this.tabBar = root.querySelector(".tabs")!;
    this.stage = root.querySelector(".stage")!;
    root.querySelector(".min")!.addEventListener("click", () => this.appWindow.minimize());
    root.querySelector(".max")!.addEventListener("click", () => this.appWindow.toggleMaximize());
    root.querySelector(".close")!.addEventListener("click", () => this.appWindow.close());
    root.style.setProperty("--radius", `${this.settings.window_radius}px`);
    document.addEventListener("keydown", (e) => this.onKey(e), true);
    this.appWindow.onCloseRequested(async (e) => {
      if (this.closing) return;
      e.preventDefault();
      this.closing = true;
      await this.saveSession().catch(() => {});
      await this.appWindow.destroy();
    });
    this.applyThemeCss();
  }

  // ── WindowHost ──
  theme(): ThemeName {
    return this.themeName;
  }
  fontFamily(): string {
    return this.font.family;
  }
  fontSize(): number {
    return Math.round(this.font.size * this.fontScale * 10) / 10;
  }
  isActive(p: Pane): boolean {
    return this.active === p;
  }
  multi(p: Pane): boolean {
    const tab = this.tabs.find((t) => paneIds(t.root).includes(p.id));
    return !!tab && tab.root.kind === "split";
  }
  focusChanged(p: Pane) {
    if (this.active === p) return;
    const old = this.active;
    this.active = p;
    old?.restyle();
    p.restyle();
    this.updateTitle();
  }
  titleChanged(p: Pane) {
    if (p === this.active) this.updateTitle();
    this.updateTabLabels();
  }
  overlaysChanged() {
    // the window stays above the others while any pane has the notepad open (GNOME on Wayland may not allow it)
    const on = [...this.panes.values()].some((p) => p.overlay?.kind === "note");
    if (on !== this.onTop) {
      this.onTop = on;
      this.appWindow.setAlwaysOnTop(on).catch(() => {});
    }
  }
  notify(title: string, body: string) {
    (async () => {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
    })().catch(() => {});
  }
  paneExited(p: Pane) {
    this.closePane(p, true);
  }

  // ── panes and tabs ──
  private makePane(opts: Partial<PaneOpts> & { character?: CharName }): Pane {
    const character = opts.character ?? nextCharacter(this.lastCharacter).name;
    this.lastCharacter = character;
    const p = new Pane(this, { ...opts, character });
    this.panes.set(p.id, p);
    return p;
  }

  newTab(opts: Partial<PaneOpts> = {}): Pane {
    const p = this.makePane(opts);
    this.addTab({ kind: "pane", id: p.id });
    this.focusPane(p);
    return p;
  }

  private addTab(root: Node) {
    const el = document.createElement("div");
    el.className = "tab";
    const label = document.createElement("button");
    label.addEventListener("click", () => this.showTab(this.tabs.findIndex((t) => t.el === el)));
    this.tabBar.append(label);
    this.stage.append(el);
    this.tabs.push({ root, el, label });
    this.render(this.tabs.length - 1);
    this.showTab(this.tabs.length - 1);
  }

  private showTab(i: number) {
    if (i < 0 || i >= this.tabs.length) return;
    this.current = i;
    this.tabs.forEach((t, j) => {
      t.el.hidden = j !== i;
      t.label.classList.toggle("current", j === i);
    });
    this.tabBar.hidden = this.tabs.length < 2;
    const first = paneIds(this.tabs[i].root).map((id) => this.panes.get(id)!);
    requestAnimationFrame(() => first.forEach((p) => p.layout()));
    const target = first.includes(this.active!) ? this.active! : first[0];
    if (target) this.focusPane(target);
    this.updateTabLabels();
  }

  /** Lay a tab's tree out as nested flex boxes, reusing each pane's element (its terminal keeps going). */
  private render(i: number) {
    const tab = this.tabs[i];
    const make = (n: Node): HTMLElement => {
      if (n.kind === "pane") return this.panes.get(n.id)!.el;
      const box = document.createElement("div");
      box.className = `split ${n.orient}`;
      const a = make(n.a), b = make(n.b);
      a.style.flex = `${n.ratio} 1 0`;
      b.style.flex = `${1 - n.ratio} 1 0`;
      const divider = document.createElement("div");
      divider.className = "divider";
      divider.addEventListener("pointerdown", (e) => this.dragDivider(e, box, n, a, b));
      box.append(a, divider, b);
      return box;
    };
    const el = make(tab.root);
    el.style.flex = "1 1 0";
    tab.el.replaceChildren(el);
    requestAnimationFrame(() => paneIds(tab.root).forEach((id) => this.panes.get(id)?.layout()));
    paneIds(tab.root).forEach((id) => this.panes.get(id)?.restyle());
  }

  private dragDivider(e: PointerEvent, box: HTMLElement, n: Node & { kind: "split" }, a: HTMLElement, b: HTMLElement) {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect();
      const ratio = n.orient === "h" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      n.ratio = Math.min(0.95, Math.max(0.05, ratio));
      a.style.flex = `${n.ratio} 1 0`;
      b.style.flex = `${1 - n.ratio} 1 0`;
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  }

  private tabOf(p: Pane): number {
    return this.tabs.findIndex((t) => paneIds(t.root).includes(p.id));
  }

  split(orient: "h" | "v") {
    const old = this.active;
    if (!old) return;
    const i = this.tabOf(old);
    const p = this.makePane({ cwd: old.cwd });
    this.tabs[i].root = split(this.tabs[i].root, old.id, orient, p.id);
    this.render(i);
    this.focusPane(p);
  }

  closePane(p: Pane, exited = false) {
    if (!exited && p.closeTop()) return;   // Ctrl/Cmd+W closes what's over the pane first
    const i = this.tabOf(p);
    if (i < 0) return;
    const rest = remove(this.tabs[i].root, p.id);
    this.panes.delete(p.id);
    p.dispose();
    if (this.active === p) this.active = null;
    if (rest) {
      this.tabs[i].root = rest;
      this.render(i);
      this.focusPane(this.panes.get(paneIds(rest)[0])!);
    } else {
      const [tab] = this.tabs.splice(i, 1);
      tab.el.remove();
      tab.label.remove();
      if (!this.tabs.length) {   // every shell exited: nothing to restore next time
        this.closing = true;
        clearSession().finally(() => this.appWindow.destroy());
        return;
      }
      this.showTab(Math.min(i, this.tabs.length - 1));
    }
    this.overlaysChanged();
    this.updateTitle();
  }

  focusPane(p: Pane) {
    this.focusChanged(p);
    requestAnimationFrame(() => p.focus());
  }

  private moveFocus(dx: number, dy: number) {
    if (!this.active || this.current < 0) return;
    const centres = new Map<number, { x: number; y: number }>();
    for (const id of paneIds(this.tabs[this.current].root)) {
      const r = this.panes.get(id)!.el.getBoundingClientRect();
      centres.set(id, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    const to = neighbour(centres, this.active.id, dx, dy);
    if (to !== null) this.focusPane(this.panes.get(to)!);
  }

  /** `pair` / `magica`: the pane it was typed in becomes the first character and the rest are built around it (in a
   * new tab if this one is already split, so no shell gets closed). */
  applyLayout(pane: Pane, name: "pair" | "magica") {
    let i = this.tabOf(pane);
    if (i < 0) return;
    const cwd = pane.cwd;
    if (this.tabs[i].root.kind === "split") {
      pane = this.newTab({ cwd, character: "madoka" });
      i = this.tabOf(pane);
    }
    let reuse: Pane | null = pane;
    const root = build(LAYOUTS[name], (who) => {
      if (reuse) {
        const p = reuse;
        reuse = null;
        if (p.character !== who) p.setCharacter(who as CharName);
        return { kind: "pane", id: p.id };
      }
      return { kind: "pane", id: this.makePane({ cwd, character: who as CharName }).id };
    });
    this.tabs[i].root = root;
    this.render(i);
    this.focusPane(pane);
    this.updateTabLabels();
  }

  // ── title, tabs, theme, font ──
  private updateTitle() {
    const p = this.active;
    if (!p) return;
    this.titleWho.textContent = `${p.character}@magica`;
    this.titleWhere.textContent = p.where;
    this.root.style.setProperty("--accent", p.colour());
    this.updateTabLabels();
  }

  private updateTabLabels() {
    this.tabs.forEach((t, i) => {
      const ids = paneIds(t.root);
      const first = this.panes.get(ids[0]);
      t.label.textContent = ids.length > 1 ? `Tab ${i + 1}` : first ? first.character[0].toUpperCase() + first.character.slice(1) : "";
    });
  }

  private applyThemeCss() {
    const t = THEMES[this.themeName];
    const s = this.root.style;
    s.setProperty("--bg", t.bg);
    s.setProperty("--fg", t.fg);
    s.setProperty("--dim", t.dim);
    s.setProperty("--font", this.font.family);
    document.documentElement.dataset.theme = this.themeName;
  }

  setTheme(name: ThemeName) {
    this.themeName = name;
    writeText("theme", name + "\n").catch(() => {});
    this.applyThemeCss();
    this.panes.forEach((p) => p.themeChanged());
    this.updateTitle();
  }

  private setFontScale(k: number) {
    this.fontScale = Math.min(4, Math.max(0.3, k));
    this.panes.forEach((p) => p.setFont(this.font.family, this.fontSize()));
  }

  // ── keys ──
  private onKey(e: KeyboardEvent) {
    const a = actionFor(e, this.os === "mac" ? "mac" : "other");
    if (!a) return;
    // copy / paste / search inside the notepad or `space` are their own
    const inOverlay = this.active?.overlay && (a === "copy" || a === "paste" || a === "search");
    const inSearch = this.active?.hasSearch() && (a === "copy" || a === "paste");
    if (inOverlay || inSearch) return;
    e.preventDefault();
    e.stopPropagation();
    this.perform(a);
  }

  private perform(a: Action) {
    const p = this.active;
    if (typeof a === "object") {
      if ("tab" in a) {   // like Chrome: 1…8 pick that tab, 9 the last one
        if (a.tab === 9) this.showTab(this.tabs.length - 1);
        else if (a.tab <= this.tabs.length) this.showTab(a.tab - 1);
      } else this.moveFocus(...a.move);
      return;
    }
    switch (a) {
      case "splitRight": return this.split("h");
      case "splitDown": return this.split("v");
      case "close": return p && this.closePane(p);
      case "newTab": return void this.newTab({ cwd: p?.cwd });
      case "prevTab": return this.showTab((this.current - 1 + this.tabs.length) % this.tabs.length);
      case "nextTab": return this.showTab((this.current + 1) % this.tabs.length);
      case "copy": {
        const sel = p?.copy();
        if (sel) clipboardWrite(sel).catch(() => {});
        return;
      }
      case "paste": return void clipboardRead().then((t) => t && p?.paste(t)).catch(() => {});
      case "fontUp": return this.setFontScale(this.fontScale * 1.1);
      case "fontDown": return this.setFontScale(this.fontScale / 1.1);
      case "fontReset": return this.setFontScale(1);
      case "toggleTheme": return this.setTheme(this.themeName === "dark" ? "light" : "dark");
      case "search": return p?.openSearch();
    }
  }

  // ── session ──
  private async serialize(n: Node): Promise<unknown> {
    if (n.kind === "split") return { orient: n.orient, ratio: n.ratio, a: await this.serialize(n.a), b: await this.serialize(n.b) };
    const p = this.panes.get(n.id)!;
    const agent = p.ptyIdForSession ? await paneResume(p.ptyIdForSession).catch(() => null) : null;
    if (agent) return { char: p.character, cwd: agent.cwd ?? p.cwd, resume: agent.resume };   // it shows its own conversation again
    return { char: p.character, cwd: p.cwd, text: p.history() };
  }

  async saveSession() {
    if (!this.tabs.length) return;
    const size = await this.appWindow.innerSize();
    const scale = await this.appWindow.scaleFactor();
    const data = {
      size: [Math.round(size.width / scale), Math.round(size.height / scale)],
      current: this.current,
      tabs: await Promise.all(this.tabs.map((t) => this.serialize(t.root))),
    };
    await saveSession(JSON.stringify(data, null, 1));
  }

  /** Bring back a saved session; false (and nothing changed) if it isn't usable. */
  restore(data: unknown): boolean {
    const d = data as { tabs?: unknown[]; current?: number } | null;
    const trees = (d?.tabs ?? []).map(readTree).filter((t): t is SavedNode => t !== null);
    if (!trees.length) return false;
    for (const tree of trees) {
      const make = (n: SavedNode): Node => {
        if (n.kind === "split") return { kind: "split", orient: n.orient, ratio: n.ratio, a: make(n.a), b: make(n.b) };
        const p = this.makePane({ character: n.char, cwd: n.cwd, text: n.resume ? undefined : n.text, resume: n.resume });
        return { kind: "pane", id: p.id };
      };
      this.addTab(make(tree));
    }
    this.showTab(Math.min(Math.max(0, d?.current ?? 0), this.tabs.length - 1));
    return true;
  }

  firstPane(): Pane | undefined {
    return this.tabs.length ? this.panes.get(paneIds(this.tabs[this.current].root)[0]) : undefined;
  }
}
