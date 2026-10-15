// Magica Terminal for Windows: Electron main process. It owns the shells (ConPTY via node-pty), the config files,
// notifications and the window; renderer.js draws the panes. Settings for the panes are at the top of renderer.js.
const { app, BrowserWindow, Menu, Notification, clipboard, ipcMain, nativeTheme, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');

const CONFIG = path.join(app.getPath('appData'), 'magica-terminal');
const THEME_FILE = path.join(CONFIG, 'theme');          // "light", "dark" or "system"
const SESSION_FILE = path.join(CONFIG, 'session.json'); // tabs / splits saved on close
const SETTINGS_FILE = path.join(CONFIG, 'settings.json'); // overrides renderer.js settings (see there)
const INTEGRATION = path.join(__dirname, 'shell', 'magica.ps1');
const APP_ID = 'dev.local.MagicaTerminal';
const HOTKEY = 'CTRL+ALT+T';   // opens a new window from anywhere (Start Menu shortcut key; '' = none)

// PowerShell 7 if it's installed, else Windows PowerShell; MAGICA_SHELL overrides (no shell integration for other shells)
function findShell() {
  if (process.env.MAGICA_SHELL) return process.env.MAGICA_SHELL;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, 'pwsh.exe');
    if (dir && fs.existsSync(p)) return p;
  }
  return 'powershell.exe';
}
const SHELL = findShell();

app.setAppUserModelId(APP_ID);   // toasts are attributed to the Start Menu shortcut with this id
const firstInstance = app.requestSingleInstanceLock();   // others still open, they just don't restore the session

// `npm run shortcut`: Start Menu entry (also what lets Windows show notifications for an unpackaged app)
if (process.argv.includes('--install-shortcut')) {
  app.whenReady().then(() => {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Magica Terminal.lnk');
    const ok = shell.writeShortcutLink(lnk, {
      target: process.execPath, args: `"${__dirname}"`, cwd: os.homedir(), appUserModelId: APP_ID,
      description: 'Terminal where every pane belongs to a Puella Magi character',
    });
    console.log(ok ? `created ${lnk}` : `could not create ${lnk}`);
    if (ok) {   // Electron can't set a shortcut key, Windows Script Host can (and keeps the app id)
      const { execFileSync } = require('child_process');
      const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:MAGICA_LNK); $s.Hotkey = $env:MAGICA_HOTKEY; $s.Save()`;
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
                     { env: { ...process.env, MAGICA_LNK: lnk, MAGICA_HOTKEY: HOTKEY } });
        if (HOTKEY) console.log(`shortcut key ${HOTKEY}`);
      } catch (err) {
        console.log(`could not set the shortcut key: ${err.message}`);
      }
    }
    app.quit();
  });
  return;
}

// `magica-terminal CMD ARGS…` or `-e CMD ARGS…` runs CMD in the first pane
// (skipping Chromium / Node switches and, when run as `electron .`, the app folder)
let command = process.argv.slice(1);
const skip = a => /^--[\w-]+(=|$)/.test(a) || (!app.isPackaged && path.resolve(a) === __dirname);
while (command.length && skip(command[0])) command.shift();
if (['-e', '--'].includes(command[0])) command = command.slice(1);
if (!command.length) command = null;

function readTheme() {
  try {
    const t = fs.readFileSync(THEME_FILE, 'utf8').trim();
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function writeFile(file, text) {
  try {
    fs.mkdirSync(CONFIG, { recursive: true });
    fs.writeFileSync(file, text);
  } catch {}
}

// ── shells ──
const ptys = new Map();   // id → { proc, win }
let nextId = 1;

ipcMain.handle('pty:spawn', (e, { cols, rows, cwd, character, argv }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let file, args;
  if (argv) {
    [file, ...args] = argv;
  } else {
    file = SHELL;
    args = /(^|[\\/])(pwsh|powershell)(\.exe)?$/i.test(SHELL)
      ? ['-NoLogo', '-NoExit', '-Command', `. '${INTEGRATION.replace(/'/g, "''")}'`]
      : [];
  }
  const start = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  let proc;
  try {
    proc = pty.spawn(file, args, {
      name: 'xterm-256color', cols, rows, cwd: start, useConptyDll: true,
      env: { ...process.env, MAGICA_CHAR: character, TERM_PROGRAM: 'magica-terminal' },
    });
  } catch (err) {
    return { error: String(err.message || err) };
  }
  const id = nextId++;
  ptys.set(id, { proc, win });
  proc.onData(data => !win.isDestroyed() && win.webContents.send('pty:data', id, data));
  proc.onExit(({ exitCode }) => {
    ptys.delete(id);
    if (!win.isDestroyed()) win.webContents.send('pty:exit', id, exitCode);
  });
  return { id, cwd: start };
});
ipcMain.on('pty:write', (_, id, data) => ptys.get(id)?.proc.write(data));
ipcMain.on('pty:resize', (_, id, cols, rows) => {
  try { ptys.get(id)?.proc.resize(Math.max(cols, 2), Math.max(rows, 1)); } catch {}
});
ipcMain.on('pty:kill', (_, id) => {
  try { ptys.get(id)?.proc.kill(); } catch {}
});

// ── everything else the renderer asks for ──
ipcMain.handle('init', () => {
  let session = null;
  if (firstInstance && !command) {
    try { session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch {}
  }
  return { theme: readTheme(), session, command };
});
ipcMain.on('settings', e => {   // synchronous: renderer.js needs them before its first line runs
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`${SETTINGS_FILE}: ignored (${err.message})`);
  }
  e.returnValue = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
});
ipcMain.on('theme:save', (_, name) => writeFile(THEME_FILE, name + '\n'));
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.on('clipboard:write', (_, text) => clipboard.writeText(text));
ipcMain.handle('path:resolve', (_, p, cwd) => {
  // a file path as printed in the terminal → an absolute path, if it exists
  p = p.replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(p) && cwd) p = path.join(cwd, p);
  return fs.existsSync(p) ? p : null;
});
ipcMain.on('open', (_, target) => {
  if (/^[a-z][\w+.-]*:\/\//i.test(target)) shell.openExternal(target);
  else shell.openPath(target);
});
ipcMain.on('notify', (e, { title, body, icon }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: icon && fs.existsSync(icon) ? icon : undefined });
  n.on('click', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
  n.show();
});
ipcMain.on('flash', e => BrowserWindow.fromWebContents(e.sender)?.flashFrame(true));
// every shell exited: nothing to restore next time
ipcMain.on('quit-empty', e => {
  try { fs.unlinkSync(SESSION_FILE); } catch {}
  BrowserWindow.fromWebContents(e.sender)?.destroy();
});

function createWindow() {
  const theme = readTheme();
  let [width, height] = [1100, 700];
  try {
    if (firstInstance && !command) [width, height] = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')).size;
  } catch {}
  const win = new BrowserWindow({
    width, height, title: 'Magica Terminal', show: false,
    backgroundColor: theme === 'dark' ? '#1d1d1c' : '#e9e8e4',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.once('ready-to-show', () => win.show());
  win.on('focus', () => win.flashFrame(false));
  // closing the window saves its tabs, splits, characters and folders
  let saved = false;
  win.on('close', e => {
    if (saved) return;
    e.preventDefault();
    const done = () => { if (!saved) { saved = true; win.destroy(); } };
    ipcMain.once('session:save', (_, data) => {
      if (data) writeFile(SESSION_FILE, JSON.stringify(data, null, 1));
      done();
    });
    win.webContents.send('session:get');
    setTimeout(done, 1500);   // renderer hung: close anyway
  });
  win.on('closed', () => {
    for (const [id, p] of ptys) if (p.win === win) { try { p.proc.kill(); } catch {} ptys.delete(id); }
  });
  // DevTools for poking at it; everything else goes to the terminal
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}

Menu.setApplicationMenu(null);   // no menu accelerators stealing Ctrl+R, Ctrl+W, …
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
