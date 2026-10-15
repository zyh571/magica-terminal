// Magica Terminal for Windows: the window's contents. A port of the GTK app's Pane / Window (../magica-terminal):
// every pane is an xterm.js terminal with a transparent background, her figure in the bottom-right corner in front
// of the text, and the prompt, cursor and selection in her colour. Shells report commands with OSC 666, as
// vte.shell.preexec / vte.shell.postexec=<status> (shell/magica.ps1), and their folder with OSC 9;9.
// Keys, behaviour and settings match the Linux version; settings are the constants below, and the ones wrapped in
// setting() can be overridden by their lower-case names in %APPDATA%\magica-terminal\settings.json, e.g.
// {"idle_bob": 16, "font_size": 16, "idle_every": [4, 8], "notify": false}
'use strict';

const usedSettings = new Set();
function setting(name, value) {
  const key = name.toLowerCase(), v = magica.settings[key];
  usedSettings.add(key);
  if (v === undefined) return value;
  const ok = value instanceof Set ? Array.isArray(v) && v.every(Number.isInteger)
    : Array.isArray(value) ? Array.isArray(v) && v.length === value.length && v.every(x => typeof x === 'number')
    : typeof v === typeof value;
  if (!ok) { console.warn(`settings.json: bad value for "${key}":`, v); return value; }
  return value instanceof Set ? new Set(v) : v;
}

const FONT_FAMILY = setting('FONT_FAMILY', '"Cascadia Mono", Consolas, "Courier New", monospace');
const FONT_SIZE = setting('FONT_SIZE', 15);     // px
const PADDING = 10;       // px around the text (style.css .term-host)

// Figure size, as at full screen (1920x1080): a pane keeps the full-screen size while either its width or height is
// still full, and shrinks once both shrink.
const FIG_HEIGHT = setting('FIG_HEIGHT', 240), FIG_RIGHT = setting('FIG_RIGHT', 30), FIG_BOTTOM = setting('FIG_BOTTOM', 12);
const BASE_HEIGHT = setting('BASE_HEIGHT', 5), BASE_GAP = setting('BASE_GAP', 4);   // coloured bar under the focused pane's figure (px, 0 = off), and its gap above the bottom edge
const HOVER_OPACITY = setting('HOVER_OPACITY', 0.25);   // figure opacity while the mouse is over it
const FAIL_FLASH = setting('FAIL_FLASH', 0.5);       // s the figure and the bar under it stay tinted red after a command fails (0 = off)
const FAIL_TINT = setting('FAIL_TINT', 0.5);        // how much red is mixed into them
const FAIL_SQUASH = setting('FAIL_SQUASH', 0.15);     // …and she gets squashed: this much shorter (and a bit wider) for a moment (0 = off)
const FAIL_RED = setting('FAIL_RED', '#ff1f1f');
// exit statuses that don't count as failures: 130 (Ctrl+C in bash) and STATUS_CONTROL_C_EXIT (Ctrl+C on Windows)
const IGNORED_EXIT = setting('IGNORED_EXIT', new Set([130, -1073741510, 3221225786]));
const LONG_COMMAND = setting('LONG_COMMAND', 10);      // s: a command running at least this long in a pane you're not looking at → she hops (0 = off)
const HOP_HEIGHT = setting('HOP_HEIGHT', 22), HOPS = setting('HOPS', 3);
const JUMP_HEIGHT = setting('JUMP_HEIGHT', 20);       // every successful command: one small jump of this height (0 = off)
const NOTIFY = setting('NOTIFY', true);          // …and a notification when the window isn't active
const IDLE_AFTER = setting('IDLE_AFTER', 15);        // s without output or typing before she starts idling (0 = off)
const IDLE_EVERY = setting('IDLE_EVERY', [6, 14]);   // s between idle moves (random in this range)
const IDLE_BOB = setting('IDLE_BOB', 12), IDLE_BREATH = setting('IDLE_BREATH', 0.04);

// hot commands typed in the shell: equal splits, "h" = side by side, "v" = stacked
const LAYOUTS = {
  pair: ['h', ['madoka', 'homura']],
  magica: ['v', [['h', ['madoka', 'homura']], ['h', ['sayaka', 'mami', 'kyoko']]]],
};
// Ctrl+click opens file paths (if they exist) as well as URLs and programs' own OSC 8 hyperlinks
const PATH_REGEX = /(?<![\w\\/~.:-])(?:[A-Za-z]:|~)(?:[\\/][\w.+@%$-]*[\w+@%$-])+[\\/]?/g;
const TEXT_SATURATION = setting('TEXT_SATURATION', 0.55);   // her colour at this fraction of the saturation for typed commands
const PATH_SATURATION = setting('PATH_SATURATION', 0.4);
const CHAR_SLOTS = 100;         // palette slots 100…117: per character name / text / path colours, 118: red accent
const RED_SLOT = 118;
const FOCUS_TINT = setting('FOCUS_TINT', 0.08);        // focused pane background: this much of her colour mixed in (when a tab has several panes)

// [name, colour on dark, colour on light]
const CHARACTERS = [
  ['madoka', '#ff9cc6', '#c2386f'],
  ['homura', '#b9a0ff', '#6a4bb8'],
  ['sayaka', '#8cbcff', '#2f6fc0'],
  ['mami', '#f2cf6b', '#9a6f0e'],
  ['kyoko', '#ff7a86', '#c22f3c'],
];
const KYUBEY = ['kyubey', '#f4f4f4', '#1f1f24'];   // takes over a pane while it runs an elevated shell
const KYUBEY_GREYS = {   // name / text / path / accent: Kyubey is only white, grey and black
  dark: ['#f4f4f4', '#c9c9cc', '#9b9ba0', '#8a8a8f'],
  light: ['#1f1f24', '#46464c', '#6b6b72', '#7a7a80'],
};
const ALL_CHARACTERS = [...CHARACTERS, KYUBEY];

for (const key of Object.keys(magica.settings)) if (!usedSettings.has(key)) console.warn(`settings.json: unknown setting "${key}"`);

const THEMES = {   // Tiro Finale palettes
  dark: { bg: '#1d1d1c', fg: '#d4d2cc', dim: '#7f7d78', selFg: '#1b1a1f', palette: [
    '#2b2b2a', '#c46a5e', '#8fa874', '#c9a54a', '#7f9bb8', '#b08aa8', '#7fada6', '#bdbbb5',
    '#6b6a66', '#d98275', '#a5bd8a', '#e0bd5e', '#98b2cc', '#c6a0bd', '#95c2bb', '#ecebe7'] },
  light: { bg: '#e9e8e4', fg: '#3a3a3a', dim: '#9a9893', selFg: '#f6f5f2', palette: [
    '#2e2e2e', '#a3473d', '#5f7a45', '#8f6d1f', '#4d6680', '#85587a', '#4f7a73', '#a8a7a2',
    '#7c7b77', '#c0574a', '#6f8c52', '#b08a2e', '#5f7c99', '#9a6a8e', '#5f918a', '#f6f5f2'] },
};
const ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed',
  'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

// ── colours ──
const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function mix(a, b, t) {   // blend hex colour a toward b by fraction t
  const ca = hexToRgb(a), cb = hexToRgb(b);
  return rgbToHex(ca.map((x, i) => x + (cb[i] - x) * t));
}

function desaturate(hex, amount) {   // HLS saturation × amount (like Python's colorsys)
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return hex;
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const s2 = s * amount;
  const q = l <= 0.5 ? l * (1 + s2) : l + s2 - l * s2, p = 2 * l - q;
  const hue = t => {
    t = ((t % 6) + 6) % 6 / 6;
    if (t < 1 / 6) return p + (q - p) * t * 6;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex([hue(h + 2), hue(h), hue(h - 2)].map(v => v * 255));
}

function palette(theme) {   // full 256 colours: the theme's 16, the xterm cube and grey ramp, then the character slots
  const pal = [...THEMES[theme].palette];
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) pal.push(rgbToHex([steps[r], steps[g], steps[b]]));
  for (let i = 0; i < 24; i++) pal.push(rgbToHex([8 + 10 * i, 8 + 10 * i, 8 + 10 * i]));
  ALL_CHARACTERS.forEach(([name, dark, light], i) => {
    const slot = CHAR_SLOTS + 3 * i;
    if (name === 'kyubey') {
      const g = KYUBEY_GREYS[theme];
      pal.splice(slot, 3, ...g.slice(0, 3));
      pal[RED_SLOT] = g[3];
      return;
    }
    const c = theme === 'dark' ? dark : light;
    pal.splice(slot, 3, c, desaturate(c, TEXT_SATURATION), desaturate(c, PATH_SATURATION));
  });
  return pal;
}

const characterNamed = name => ALL_CHARACTERS.find(c => c[0] === name);
const figureUrl = name => new URL(`../figures/${name}.png`, location.href).href;
const figurePath = name => decodeURIComponent(new URL(figureUrl(name)).pathname).replace(/^\//, '').replace(/\//g, '\\');
const title = s => s.charAt(0).toUpperCase() + s.slice(1);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const now = () => performance.now() / 1000;
const panesById = new Map();
const panesIn = node => node instanceof Pane ? [node] : [...panesIn(node.a), ...panesIn(node.b)];

// each animation: f(t) for t in 0…1 over `length` seconds, then done()
function animate(length, f, done) {
  const start = now();
  const frame = () => {
    const t = (now() - start) / length;
    if (t >= 1) { done(); return; }
    if (f(t) !== false) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}


class Pane {
  // one terminal over a backdrop, with its character's figure in front
  constructor(win, { cwd, argv, character } = {}) {
    this.win = win;
    this.cwd = cwd || null;
    this.argv = argv || null;
    this.parent = null;
    this.focused = false;
    this.hovering = false;
    this.failing = false;
    this.cmdStart = null;
    this.stretch = 1; this.widen = 1; this.hopOffset = 0;   // breathing, squash, hops
    this.id = null;

    this.el = el('div', 'pane');
    this.host = el('div', 'term-host');
    this.fig = el('div', 'figure');
    this.img = el('img');
    this.tint = el('div', 'tint');
    this.fig.append(this.img, this.tint);
    this.base = el('div', 'base');
    this.search = el('input', 'search');
    this.search.placeholder = 'search';
    this.el.append(this.host, this.fig, this.base, this.search);
    this.img.addEventListener('load', () => { this.fig.style.display = ''; this.updateFigure(); });
    this.img.addEventListener('error', () => { this.fig.style.display = 'none'; });   // no figure for this character
    this.loadCharacter(character || win.nextCharacter());

    this.term = new Terminal({
      fontFamily: FONT_FAMILY, fontSize: Math.round(FONT_SIZE * win.fontScale), allowTransparency: true,
      allowProposedApi: true, scrollback: 10000, cursorBlink: false, theme: this.xtermTheme(),
      linkHandler: { activate: (e, uri) => e.ctrlKey && magica.open(uri) },   // OSC 8 hyperlinks
    });
    this.fit = new FitAddon.FitAddon();
    this.finder = new SearchAddon.SearchAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(this.finder);
    this.term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => e.ctrlKey && magica.open(uri)));
    this.term.registerLinkProvider({ provideLinks: (y, cb) => this.pathLinks(y, cb) });
    this.term.parser.registerOscHandler(666, data => this.onMessage(data));
    this.term.parser.registerOscHandler(9, data => {   // 9;9;"<folder>": where the shell is
      if (!data.startsWith('9;')) return false;
      this.cwd = data.slice(2).replace(/^"(.*)"$/, '$1');
      return true;
    });
    // the background is transparent (for the figure), so answer "what's your background?" (OSC 11) with the theme's
    // real one; programs like Claude Code pick their light or dark colours from it
    this.term.parser.registerOscHandler(11, data => {
      if (data !== '?') return false;
      const hex = THEMES[this.win.theme].bg.slice(1);
      this.reply(`\x1b]11;rgb:${[0, 2, 4].map(i => hex.slice(i, i + 2).repeat(2)).join('/')}\x1b\\`);
      return true;
    });
    // colour scheme reports (mode 2031, as in VTE): `CSI ? 996 n` asks for dark (1) / light (2), and programs that turn
    // on mode 2031 are told when it changes
    this.colourReports = false;
    this.reportedTheme = win.theme;
    const mode2031 = on => params => { if (params.includes(2031)) this.colourReports = on; return false; };
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, mode2031(true));
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, mode2031(false));
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'n' }, params => {
      if (params[0] !== 996) return false;
      this.reportColourScheme();
      return true;
    });
    this.term.onData(d => { this.touch(); if (this.id) magica.write(this.id, d); });
    this.term.onWriteParsed(() => this.touch());
    this.term.attachCustomKeyEventHandler(e => !(e.type === 'keydown' && this.win.onKey(e)));

    this.search.addEventListener('input', () => this.find(true, true));
    this.search.addEventListener('keydown', e => this.onSearchKey(e));
    this.search.addEventListener('focus', () => this.setFocused(true));
    this.search.addEventListener('blur', () => this.setFocused(false));
    // fade the figure while the mouse is over it, so the text behind it is readable
    this.el.addEventListener('mousemove', e => {
      const r = this.fig.getBoundingClientRect();
      this.setHovering(e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom);
    });
    this.el.addEventListener('mouseleave', () => this.setHovering(false));

    // the terminal opens and the shell starts once the pane is on screen and has a size
    this.opened = false;
    this.wantFocus = false;
    new ResizeObserver(() => this.onResize()).observe(this.el);

    this.lastActivity = now();
    if (IDLE_AFTER) this.scheduleIdle();
    this.setFocused(false);
  }

  loadCharacter(character) {
    this.character = character;
    this.name = character[0];
    this.colour = this.win.theme === 'dark' ? character[1] : character[2];
    this.img.src = figureUrl(this.name);
    this.tint.style.webkitMaskImage = this.tint.style.maskImage = `url("${figureUrl(this.name)}")`;
    if (this.term) this.applyTheme();
  }

  xtermTheme() {
    const t = THEMES[this.win.theme], pal = this.win.palette;
    const theme = {
      foreground: t.fg, background: '#00000000', cursor: this.colour, cursorAccent: t.bg,
      selectionBackground: this.colour, selectionInactiveBackground: this.colour, selectionForeground: t.selFg,
      extendedAnsi: pal.slice(16),
      scrollbarSliderBackground: t.dim + '55', scrollbarSliderHoverBackground: t.dim + '99',
      scrollbarSliderActiveBackground: t.dim + 'cc',
    };
    ANSI_NAMES.forEach((n, i) => { theme[n] = pal[i]; });
    return theme;
  }

  reply(data) { if (this.id) magica.write(this.id, data); }

  reportColourScheme() { this.reply(`\x1b[?997;${this.win.theme === 'dark' ? 1 : 2}n`); }

  applyTheme() {   // re-colour for the window's light/dark theme or a new character
    this.colour = this.win.theme === 'dark' ? this.character[1] : this.character[2];
    this.term.options.theme = this.xtermTheme();
    if (this.colourReports && this.reportedTheme !== this.win.theme) this.reportColourScheme();
    this.reportedTheme = this.win.theme;
    this.search.style.borderColor = this.colour;
    this._baseKey = null;
    this.updateFigure();
    if (this.win.active === this) this.win.updateTitle();
  }

  onResize() {
    if (this.el.clientWidth <= 1 || this.el.clientHeight <= 1) return;
    if (!this.opened) {
      this.opened = true;
      this.term.open(this.host);
      this.term.textarea.addEventListener('focus', () => this.setFocused(true));
      this.term.textarea.addEventListener('blur', () => this.setFocused(false));
      this.fit.fit();
      this.spawn();
      if (this.wantFocus) this.term.focus();
    } else {
      this.fit.fit();
      if (this.id) magica.resize(this.id, this.term.cols, this.term.rows);
    }
    this.updateFigure();
  }

  async spawn() {
    const r = await magica.spawn({ cols: this.term.cols, rows: this.term.rows, cwd: this.cwd, character: this.name,
                                   argv: this.argv });
    if (r.error) {
      this.term.write(`\x1b[31mcould not start ${this.argv ? this.argv[0] : 'the shell'}: ${r.error}\x1b[0m\r\n`);
      return;
    }
    this.id = r.id;
    this.cwd = this.cwd || r.cwd;
    panesById.set(r.id, this);
    magica.resize(this.id, this.term.cols, this.term.rows);
  }

  focus() {
    if (this.opened) this.term.focus();
    else this.wantFocus = true;
  }

  setFocused(focused) {
    this.focused = focused;
    if (focused && this.win.active !== this) {
      this.win.active = this;
      this.win.updateTitle();
    }
    this.updateFigure();
  }

  setBackground(focused, multi) {   // with several panes, the focused one gets a light tint of her colour
    const bg = THEMES[this.win.theme].bg;
    this.el.style.background = multi && focused ? mix(bg, this.colour, FOCUS_TINT) : bg;
  }

  setHovering(over) {
    if (over === this.hovering) return;
    this.hovering = over;
    this.updateFigure();
  }

  // ── messages from the shell (OSC 666) ──
  onMessage(data) {
    if (data === 'vte.shell.preexec') {
      this.cmdStart = now();
    } else if (data.startsWith('vte.shell.postexec=')) {
      if (this.cmdStart === null) return true;   // empty line: nothing ran
      const took = now() - this.cmdStart;
      this.cmdStart = null;
      const status = parseInt(data.split('=')[1], 10) || 0;
      if (status && !IGNORED_EXIT.has(status) && FAIL_FLASH) this.flashFailure();
      if (LONG_COMMAND && took >= LONG_COMMAND && !this.watched()) {
        this.hop(HOP_HEIGHT, HOPS);
        if (NOTIFY && !document.hasFocus()) this.notify(status, took);
      } else if (status === 0 && JUMP_HEIGHT) {
        this.hop(JUMP_HEIGHT, 1);
      }
    } else if (data.startsWith('magica:set:')) {   // typing a character's name in the shell
      const c = characterNamed(data.slice('magica:set:'.length).trim().toLowerCase());
      if (c && c[0] !== this.name) this.loadCharacter(c);
    } else if (data.startsWith('magica:layout:')) {   // `pair` / `magica`; the shell already became Madoka
      const name = data.slice('magica:layout:'.length).trim();
      if (LAYOUTS[name]) setTimeout(() => this.win.applyLayout(this, name));
    }
    return true;
  }

  watched() {
    return this.focused && document.hasFocus();
  }

  notify(status, took) {
    const mins = Math.floor(Math.round(took) / 60), secs = Math.round(took) % 60;
    const body = `finished after ${mins ? `${mins}m ${secs}s` : `${secs}s`}` + (status ? ` (exit ${status})` : '');
    magica.notify({ title: title(this.name), body, icon: figurePath(this.name) });
    magica.flash();
  }

  flashFailure() {
    this.failing = true;
    const fid = this._failId = (this._failId || 0) + 1;
    setTimeout(() => { if (fid === this._failId) { this.failing = false; this.updateFigure(); } }, FAIL_FLASH * 1000);
    if (FAIL_SQUASH) this.squash();
    this.updateFigure();
  }

  squash(length = 0.45) {
    const sid = this._squashId = (this._squashId || 0) + 1;
    const set = a => { this.stretch = 1 - FAIL_SQUASH * a; this.widen = 1 + FAIL_SQUASH * 0.6 * a; this.updateFigure(); };
    animate(length, t => {
      if (sid !== this._squashId) return false;   // a newer squash took over
      set(t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85) ** 2);   // quick squash, ease back
    }, () => sid === this._squashId && set(0));
  }

  hop(height, hops) {
    if (this.hopping) return;
    this.hopping = true;
    animate(0.32 * hops, t => {   // `hops` bounces, each lower than the last
      const phase = t * hops;
      this.hopOffset = height * (1 - Math.floor(phase) / hops) * 4 * (phase % 1) * (1 - phase % 1);
      this.updateFigure();
    }, () => { this.hopOffset = 0; this.hopping = false; this.updateFigure(); });
  }

  // ── idle moves ──
  touch() {
    this.lastActivity = now();
  }

  scheduleIdle() {
    const wait = IDLE_EVERY[0] + Math.random() * (IDLE_EVERY[1] - IDLE_EVERY[0]);
    this._idleTimer = setTimeout(() => {
      if (this.closed) return;
      if (now() - this.lastActivity >= IDLE_AFTER && this.el.offsetParent && !this.hovering && !this.hopping && !this.breathing) {
        Math.random() < 0.5 ? this.hop(IDLE_BOB, 2) : this.breathe();
      }
      this.scheduleIdle();
    }, wait * 1000);
  }

  breathe(length = 1.4) {
    this.breathing = true;
    animate(length, t => { this.stretch = 1 + IDLE_BREATH * Math.sin(Math.PI * t) ** 2; this.updateFigure(); },
            () => { this.stretch = 1; this.breathing = false; this.updateFigure(); });
  }

  updateFigure() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w <= 1 || h <= 1) return;
    const s = Math.max(w / 1920, h / 1080);
    const fh = Math.max(1, Math.round(FIG_HEIGHT * s));
    const ratio = this.img.naturalHeight ? this.img.naturalWidth / this.img.naturalHeight : 0.5;
    const fw = Math.max(1, Math.round(fh * ratio));
    const st = this.fig.style;
    st.width = `${fw}px`; st.height = `${fh}px`;
    st.right = `${Math.round(FIG_RIGHT * s)}px`;
    st.bottom = `${this.name === 'kyubey' ? 0 : Math.round(FIG_BOTTOM * s)}px`;
    // breathing / squash change her height (and width) with her feet in place; hops lift her
    st.transform = `translateY(${-this.hopOffset * s}px) scale(${this.widen}, ${this.stretch})`;
    st.opacity = this.hovering ? HOVER_OPACITY : 1;
    this.tint.style.opacity = this.failing ? FAIL_TINT : 0;
    // the bar: only under the focused pane's figure, or any pane's while a failure flashes
    const b = this.base.style;
    b.display = BASE_HEIGHT > 0 && (this.focused || this.failing) && this.fig.style.display !== 'none' ? '' : 'none';
    b.width = `${fw}px`;
    b.height = `${Math.max(Math.round(BASE_HEIGHT * s), 3)}px`;   // never thinner than 3px in small panes
    b.right = `${Math.round(FIG_RIGHT * s)}px`;
    b.bottom = `${Math.round(BASE_GAP * s)}px`;
    b.opacity = this.hovering ? HOVER_OPACITY : 1;
    b.background = this.failing ? mix(this.colour, FAIL_RED, FAIL_TINT) : this.colour;
  }

  // ── links ──
  async pathLinks(y, callback) {
    const line = this.term.buffer.active.getLine(y - 1);
    if (!line) return callback(undefined);
    const text = line.translateToString(true);
    const links = [];
    for (const m of text.matchAll(PATH_REGEX)) {
      const full = await magica.resolvePath(m[0], this.cwd);
      if (!full) continue;
      links.push({
        text: m[0],
        range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } },
        activate: e => e.ctrlKey && magica.open(full),
      });
    }
    callback(links.length ? links : undefined);
  }

  // ── search ──
  openSearch() {
    this.search.classList.add('open');
    this.search.select();
    this.search.focus();
  }

  closeSearch() {
    this.search.classList.remove('open');
    this.finder.clearDecorations();
    this.term.focus();
  }

  find(older, incremental = false) {
    const text = this.search.value;
    if (!text) { this.search.classList.remove('error'); this.finder.clearDecorations(); return; }
    const opts = {
      caseSensitive: /[A-Z]/.test(text), incremental,   // smart case
      decorations: { matchBackground: THEMES[this.win.theme].dim, activeMatchBackground: this.colour,
                     matchOverviewRuler: THEMES[this.win.theme].dim, activeMatchColorOverviewRuler: this.colour },
    };
    const found = older ? this.finder.findPrevious(text, opts) : this.finder.findNext(text, opts);
    this.search.classList.toggle('error', !found);
  }

  onSearchKey(e) {
    if (e.key === 'Escape') { this.closeSearch(); e.preventDefault(); }
    else if (e.key === 'Enter') { this.find(!e.shiftKey); e.preventDefault(); }
    else if (this.win.onKey(e)) e.preventDefault();
  }

  close() {
    this.closed = true;
    clearTimeout(this._idleTimer);
    if (this.id) { magica.kill(this.id); panesById.delete(this.id); }
    this.term.dispose();
  }
}


class Split {
  // two children side by side ("h") or stacked ("v"), with a draggable divider
  constructor(orient, ratio, a, b) {
    this.orient = orient;
    this.ratio = ratio;
    this.parent = null;
    this.el = el('div', `split ${orient}`);
    this.divider = el('div', 'divider');
    this.divider.addEventListener('mousedown', e => this.drag(e));
    this.setChildren(a, b);
  }

  setChildren(a, b) {
    this.a = a; this.b = b;
    a.parent = b.parent = this;
    this.el.replaceChildren(a.el, this.divider, b.el);
    this.layout();
  }

  layout() {
    this.a.el.style.flex = `${this.ratio} 1 0`;
    this.b.el.style.flex = `${1 - this.ratio} 1 0`;
  }

  drag(e) {
    e.preventDefault();
    const move = ev => {
      const r = this.el.getBoundingClientRect();
      const pos = this.orient === 'h' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      this.ratio = Math.min(0.95, Math.max(0.05, pos));
      this.layout();
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }
}


class Tab {
  constructor(win, root) {
    this.win = win;
    this.page = el('div', 'page');
    this.label = el('div', 'tab');
    this.label.addEventListener('mousedown', e => { e.preventDefault(); win.selectTab(this); });
    this.setRoot(root);
  }

  setRoot(node) {
    this.root = node;
    node.parent = this;
    node.el.style.flex = '1 1 0';
    this.page.replaceChildren(node.el);
  }

  panes() {
    return panesIn(this.root);
  }
}


class MagicaWindow {
  constructor({ theme, session, command }) {
    this.theme = theme;
    this.palette = palette(theme);
    this.charIndex = 0;   // every window starts with Madoka, then rotates
    this.fontScale = 1;
    this.active = null;
    this.tabs = [];
    this.current = null;
    this.tabBar = document.getElementById('tabs');
    this.pages = document.getElementById('pages');
    this.applyCss();
    document.addEventListener('keydown', e => {   // keys outside the terminals (search box, nothing focused)
      if (!e.target.classList?.contains('xterm-helper-textarea') && !e.target.classList?.contains('search') && this.onKey(e)) {
        e.preventDefault();
      }
    });
    addEventListener('focus', () => this.active?.updateFigure());
    magica.onSessionRequest(() => this.serialize());
    if (!(session && this.restore(session))) this.newTab({ argv: command });
  }

  nextCharacter() {
    return CHARACTERS[this.charIndex++ % CHARACTERS.length];
  }

  applyCss() {
    const t = THEMES[this.theme], s = document.documentElement.style;
    s.setProperty('--bg', t.bg);
    s.setProperty('--fg', t.fg);
    s.setProperty('--dim', t.dim);
    s.setProperty('--accent', this.active ? this.active.colour : t.fg);
    document.documentElement.style.colorScheme = this.theme;
  }

  setTheme(name) {
    this.theme = name;
    this.palette = palette(name);
    magica.saveTheme(name);
    for (const tab of this.tabs) for (const p of tab.panes()) p.applyTheme();
    this.updateTitle();
  }

  allPanes() {
    return this.tabs.flatMap(t => t.panes());
  }

  tabOf(node) {
    while (node && !(node instanceof Tab)) node = node.parent;
    return node;
  }

  // ── tabs ──
  newTab(opts = {}) {
    const pane = new Pane(this, opts);
    this.addTab(pane);
    pane.focus();
    return pane;
  }

  addTab(root) {
    const tab = new Tab(this, root);
    this.tabs.push(tab);
    this.tabBar.append(tab.label);
    this.pages.append(tab.page);
    this.selectTab(tab, false);
    return tab;
  }

  selectTab(tab, focus = true) {
    this.current = tab;
    for (const t of this.tabs) {
      t.page.classList.toggle('active', t === tab);
      t.label.classList.toggle('active', t === tab);
    }
    document.body.classList.toggle('multi-tab', this.tabs.length > 1);
    if (focus) tab.panes()[0].focus();
    this.updateTitle();
  }

  // put `node` where `old` (a Pane or Split) sits in `parent`
  replace(old, node, parent = old.parent) {
    if (parent instanceof Tab) parent.setRoot(node);
    else parent.setChildren(parent.a === old ? node : parent.a, parent.b === old ? node : parent.b);
  }

  // ── hot layouts (`pair`, `magica`) ──
  applyLayout(pane, name) {
    let tab = this.tabOf(pane);
    if (!tab) return;
    if (tab.panes().length > 1) {   // already split: build it in a new tab instead of closing shells
      let first = LAYOUTS[name];
      while (typeof first !== 'string') first = first[1][0];
      pane = this.newTab({ cwd: pane.cwd, character: characterNamed(first) });
      tab = this.current;
    }
    tab.setRoot(this.buildLayout(LAYOUTS[name], pane.cwd, [pane]));
    pane.focus();
    this.updateTitle();
  }

  buildLayout(spec, cwd, reuse) {
    if (typeof spec === 'string') {
      if (reuse.length) {   // the pane the command was typed in becomes the first character
        const p = reuse.pop();
        if (p.name !== spec) p.loadCharacter(characterNamed(spec));
        return p;
      }
      return new Pane(this, { cwd, character: characterNamed(spec) });
    }
    const [orient, items] = spec;
    return this.equalSplit(orient, items.map(i => this.buildLayout(i, cwd, reuse)));
  }

  equalSplit(orient, nodes) {
    if (nodes.length === 1) return nodes[0];
    return new Split(orient, 1 / nodes.length, nodes[0], this.equalSplit(orient, nodes.slice(1)));
  }

  // ── session ──
  serializeNode(node) {
    if (node instanceof Pane) return { char: node.name, cwd: node.cwd };
    return { orient: node.orient, ratio: node.ratio, a: this.serializeNode(node.a), b: this.serializeNode(node.b) };
  }

  serialize() {
    return { size: [outerWidth, outerHeight], current: this.tabs.indexOf(this.current),
             tabs: this.tabs.map(t => this.serializeNode(t.root)) };
  }

  deserialize(node) {
    if ('char' in node) {   // elevated (Kyubey) shells aren't restored
      return new Pane(this, { cwd: node.cwd, character: node.char !== 'kyubey' ? characterNamed(node.char) : null });
    }
    return new Split(node.orient, node.ratio, this.deserialize(node.a), this.deserialize(node.b));
  }

  restore(data) {
    try {
      if (!data.tabs?.length) return false;
      for (const tree of data.tabs) this.addTab(this.deserialize(tree));
      this.selectTab(this.tabs[Math.min(data.current || 0, this.tabs.length - 1)]);
      return true;
    } catch {
      for (const t of this.tabs) { t.panes().forEach(p => p.close()); t.page.remove(); t.label.remove(); }
      this.tabs = [];
      return false;
    }
  }

  // ── splits ──
  split(orient) {
    const old = this.active;
    if (!old || !this.tabOf(old)) return;
    const fresh = new Pane(this, { cwd: old.cwd });
    const parent = old.parent;
    this.replace(old, new Split(orient, 0.5, old, fresh), parent);   // old moves into the split, the split into its place
    fresh.focus();
    this.updateTitle();
  }

  closePane(pane) {
    const parent = pane.parent;
    pane.close();
    if (parent instanceof Split) {
      const sibling = parent.a === pane ? parent.b : parent.a;
      this.replace(parent, sibling);
      panesIn(sibling)[0].focus();
    } else if (parent instanceof Tab) {   // last pane of the tab
      const i = this.tabs.indexOf(parent);
      this.tabs.splice(i, 1);
      parent.page.remove();
      parent.label.remove();
      if (!this.tabs.length) { magica.quitEmpty(); return; }   // every shell exited: nothing to restore next time
      this.selectTab(this.current === parent ? this.tabs[Math.min(i, this.tabs.length - 1)] : this.current);
    }
    if (this.active === pane) this.active = null;
    this.updateTitle();
  }

  moveFocus(dx, dy) {
    const cur = this.active;
    if (!cur) return;
    const centre = p => { const r = p.el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const [cx, cy] = centre(cur);
    let best = null, bestD = null;
    for (const p of this.current.panes()) {
      if (p === cur) continue;
      const [px, py] = centre(p);
      const ddx = px - cx, ddy = py - cy;
      const along = ddx * dx + ddy * dy;
      if (along <= 0) continue;
      const d = along + 2 * Math.abs(ddx * dy + ddy * dx);
      if (bestD === null || d < bestD) { best = p; bestD = d; }
    }
    best?.focus();
  }

  // ── misc ──
  updateTitle() {
    document.title = 'Magica Terminal';   // always; the tab labels say which character / tab is which
    this.tabs.forEach((t, i) => {
      const panes = t.panes();
      t.label.textContent = panes.length > 1 ? `Tab ${i + 1}` : title(panes[0].name);
      for (const p of panes) p.setBackground(p === this.active, panes.length > 1);
    });
    this.applyCss();
  }

  setFontScale(scale) {
    this.fontScale = scale;
    for (const p of this.allPanes()) {
      p.term.options.fontSize = Math.round(FONT_SIZE * scale);
      p.onResize();
    }
  }

  async copy() {
    const text = this.active?.term.getSelection();
    if (text) magica.writeClipboard(text);
  }

  async paste() {
    const text = await magica.readClipboard();
    if (text && this.active) this.active.term.paste(text);
  }

  // returns true if the key was one of ours
  onKey(e) {
    const ctrl = e.ctrlKey, shift = e.shiftKey, alt = e.altKey;
    if (ctrl && shift && !alt) {
      const actions = {
        KeyO: () => this.split('h'),
        KeyE: () => this.split('v'),
        KeyW: () => this.active && this.closePane(this.active),
        KeyT: () => this.newTab({ cwd: this.active?.cwd }),
        KeyC: () => this.copy(),
        KeyV: () => this.paste(),
        Equal: () => this.setFontScale(this.fontScale * 1.1),
        NumpadAdd: () => this.setFontScale(this.fontScale * 1.1),
        Minus: () => this.setFontScale(this.fontScale / 1.1),
        NumpadSubtract: () => this.setFontScale(this.fontScale / 1.1),
        Digit0: () => this.setFontScale(1),
        KeyL: () => this.setTheme(this.theme === 'dark' ? 'light' : 'dark'),
        KeyF: () => this.active?.openSearch(),
      };
      if (actions[e.code]) { actions[e.code](); return true; }
    }
    if (ctrl && alt && !shift) {
      const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (moves[e.key]) { this.moveFocus(...moves[e.key]); return true; }
    }
    if (ctrl && !shift && !alt && (e.key === 'PageUp' || e.key === 'PageDown') && this.tabs.length > 1) {
      const step = e.key === 'PageUp' ? -1 : 1, n = this.tabs.length;
      this.selectTab(this.tabs[(this.tabs.indexOf(this.current) + step + n) % n]);
      return true;
    }
    const digit = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (ctrl && !shift && !alt && digit) {   // like Chrome: Ctrl+1…8 picks that tab, Ctrl+9 the last one
      const i = +digit[2], tab = i === 9 ? this.tabs[this.tabs.length - 1] : this.tabs[i - 1];
      if (tab) this.selectTab(tab);
      return true;
    }
    return false;
  }
}


magica.onData((id, data) => panesById.get(id)?.term.write(data));
magica.onExit(id => {
  const pane = panesById.get(id);
  if (pane) { panesById.delete(id); pane.id = null; pane.win.closePane(pane); }
});
magica.init().then(state => { window.win = new MagicaWindow(state); });
