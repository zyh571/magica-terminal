# Magica Terminal on Tauri: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Magica Terminal as one Rust + Tauri + xterm.js app with feature parity with the Linux Python app
(minus `attach`, `browser`, `wl-copy`) on Linux, macOS and Windows, then replace the old apps.

**Architecture:** `app/src-tauri` (Rust) owns PTYs, files, settings, session, process inspection and the disk scan,
and talks to the webview through Tauri commands and channels. `app/src` (TypeScript, no UI framework) draws
everything: xterm.js terminals, panes/tabs, figures, Crush, the notepad (CodeMirror 6) and `space`. Shell scripts in
`app/shell/` (bash, zsh, PowerShell) are injected by the app when it spawns a shell and talk back through escape
sequences.

**Tech Stack:** Rust stable, Tauri 2, `portable-pty`, `sysinfo`, `serde_json`; TypeScript, Vite, Vitest,
`@xterm/xterm` 5 + addons (fit, webgl, search, web-links, unicode11), CodeMirror 6; Tauri plugins: notification,
opener, clipboard-manager.

**Spec:** `docs/superpowers/specs/2026-11-12-cross-platform-tauri-design.md`

**Behaviour source of truth:** the Python app `magica-terminal` and `shell/magica.bash`. Where a task says "port X from
`magica-terminal:A-B`", read those lines and reproduce the behaviour and constants exactly, in the new language. The
Python tests named in a task are the behavioural tests to port.

## Global Constraints

- One codebase; OS-specific code only in `app/src-tauri/src/os/` (Rust `cfg` modules), `app/src/keys.ts` (keymap),
  `app/shell/*` and the installers.
- Until Task 19 (cutover): Cargo binary name `magica-dev`, config folder name `magica-terminal-dev`. Both come from
  `app/src-tauri/src/paths.rs` constants `BIN_NAME` / `APP_DIR_NAME` (the binary name also in `Cargo.toml [[bin]]`).
  (`magica-terminal-dev` would be truncated to the old app's 15-char process name `magica-terminal` and block its restore.)
- Config folder: Linux `~/.config/<APP_DIR_NAME>`, macOS `~/Library/Application Support/<APP_DIR_NAME>`, Windows
  `%APPDATA%\<APP_DIR_NAME>` (`dirs::config_dir()` gives exactly these). File names unchanged: `settings.json`,
  `theme`, `session.json`, `note.txt`, `crush.json`, `env-trust`.
- Every file write goes through `fsio::write_file` (temp file `<path>.<pid>.tmp`, fsync, rename); `session.json`
  private (0600 on Unix).
- No network at runtime. Maple Mono (OFL) is bundled; font stack `"Maple Mono", "Ubuntu Sans Mono", Menlo,
  "Cascadia Mono", monospace`, size 11pt default (setting `font`, value like `"Maple Mono 11"`, parsed as family list + size).
- Escape protocol: private `OSC 9973 ; <verb>[;<arg>] ST` (verbs `set`, `layout`, `crush`, `note`, `space`);
  `OSC 133 ; A|B|C|D[;<exit>]`; `OSC 7 ; file://<host><path>`. Shell scripts are gated on `MAGICA_APP=tauri` and
  `MAGICA_CHAR`.
- Palette slots: character `i` (order madoka, homura, sayaka, mami, kyoko, kyubey) uses 100+3i (name), 101+3i (text),
  102+3i (path); 118 = red accent. Scripts hard-code these (no `colors.sh`).
- All settings from `magica-terminal:173-183` `SETTINGS` except `BROWSER_HOME`, `BROWSER_SEARCH`, with the same defaults
  (`magica-terminal:89-138`) and validation (`magica-terminal:186-223`).
- macOS keys per the spec's Keys table; Linux/Windows keep `magica-terminal:3420-3492`.

## Review Focus

1. **Huge or fast output** (`yes`, `cat` of a big log): the UI must stay responsive; PTY reads are batched (≤64 KiB per
   channel message) and xterm writes use its flow control. Test in Task 2 (throughput) and Task 3 (manual `yes | head -c 50M`).
2. **Malformed or hostile escape input** (`OSC 9973` with unknown verbs, a path with `;` or newlines, huge args): ignored
   or handled, never thrown. Tests in Task 4.
3. **Unicode paths and folder names with spaces** (and `C:\Users\Zoë\My Files` on Windows) through OSC 7, `space`, the
   session and `.env` trust: Tasks 4, 11 and 15 each test one non-ASCII + space path.
4. **Missing or corrupt files** (`session.json` truncated, `settings.json` not an object, `crush.json` garbage, unreadable
   folder in `space`): start clean with a warning, never crash. Tests in Tasks 1, 11, 12 and 15.
5. **A shell that exits immediately or isn't installed** (bad `$SHELL`, no `pwsh`): the pane shows a one-line error
   and the fallback shell (`/bin/sh` on Unix, `powershell.exe` on Windows) is tried. Test in Task 2.

---

### Task 0: Toolchain and scaffold

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/vitest.config.ts`, `app/index.html`,
  `app/src/main.ts`, `app/src/style.css`
- Create: `app/src-tauri/Cargo.toml`, `app/src-tauri/build.rs`, `app/src-tauri/tauri.conf.json`,
  `app/src-tauri/capabilities/default.json`, `app/src-tauri/src/main.rs`, `app/src-tauri/src/lib.rs`
- Create: `app/public/fonts/` (Maple Mono Regular, Bold, Italic, BoldItalic as `.woff2` or `.ttf`, plus `OFL.txt`),
  `app/public/figures/*.png` (copies of `figures/`)
- Create: `app/.gitignore` (`node_modules`, `dist`, `src-tauri/target`)

**Interfaces:**
- Produces: `npm test` (vitest), `npm run tauri dev`, `cargo test` in `app/src-tauri`.

- [ ] **Step 1: Install prerequisites.** Rust via rustup; on Ubuntu `sudo apt install libwebkit2gtk-4.1-dev
  build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev zsh`; PowerShell 7 (`pwsh`)
  via Microsoft's package repo or `snap install powershell --classic`. `sudo` needs the owner: ask them to run it with
  the `!` prefix. Then `rustup target add x86_64-pc-windows-msvc aarch64-apple-darwin x86_64-apple-darwin`.
  Expected: `cargo --version`, `zsh --version`, `pwsh --version`, `pkg-config --modversion webkit2gtk-4.1` all print versions.
- [ ] **Step 2: Scaffold** a Tauri 2 vanilla-TS app in `app/` (`npm create tauri-app` or by hand), product name
  "Magica Terminal", identifier `dev.local.magica-terminal`, `[[bin]] name = "magica-dev"`, window `decorations: false`,
  `transparent: true`, macOS `titleBarStyle: "Overlay"` with `hiddenTitle: true`. Add deps from Tech Stack. Bundle
  `app/shell/` as Tauri resources.
- [ ] **Step 3: Fetch the font** from the URL and SHA-256 in `install.sh:19-20`, verify the checksum, and keep the
  four TTFs plus the license.
- [ ] **Step 4: Smoke tests.** `app/src/smoke.test.ts`: `expect(1 + 1).toBe(2)`. Rust `lib.rs` `#[test] fn smoke()`.
  Run `cd app && npm test` and `cd app/src-tauri && cargo test`. Expected: both pass.
- [ ] **Step 5: Foreign targets.** Run `cargo check --target x86_64-pc-windows-msvc` and `--target aarch64-apple-darwin`.
  Expected: success. If a dependency's build script needs the foreign SDK, note it in
  `docs/superpowers/plans/os-check-notes.md` and keep going (these checks are then repeated in Task 18 only).
- [ ] **Step 6: Run** `npm run tauri dev`. Expected: an empty transparent window titled "Magica Terminal" opens.
- [ ] **Step 7: Commit** `chore(app): scaffold Tauri app`.

### Task 1: Paths, atomic writes, settings

**Files:**
- Create: `app/src-tauri/src/paths.rs`, `app/src-tauri/src/fsio.rs`, `app/src-tauri/src/settings.rs`
- Create: `app/src/settings.ts` (types only)
- Test: inline `#[cfg(test)]` modules

**Interfaces:**
- Produces (Rust): `paths::config_dir() -> PathBuf`, `paths::file(name: &str) -> PathBuf`, consts `BIN_NAME`,
  `APP_DIR_NAME`; `fsio::write_file(path: &Path, text: &str, private: bool) -> bool`;
  `settings::Settings` (serde, every field from Global Constraints, snake_case names), `settings::load(path: &Path) -> (Settings, Vec<String>)` (warnings);
  Tauri command `get_settings() -> Settings` (loaded once at start, warnings printed to stderr as
  `magica-terminal: <path>: <msg>`).
- Produces (TS): `interface Settings` mirroring the Rust struct; `IGNORED_EXIT` as `number[]`, `IDLE_EVERY` as `[number, number]`,
  `FOCUS_BRIGHTEN` as `{dark: number, light: number}`.

- [ ] **Step 1: Write failing tests** in `settings.rs`: `missing_file_gives_defaults`, `overrides_known_names`
  (`{"idle_bob": 16, "idle_every": [4, 8], "notify": false}` → those values), `unknown_name_warns`
  (`{"zzz": 1}` → one warning containing `unknown setting 'zzz'`), `bad_value_warns` (`{"hops": "3"}`, `{"notify": 1}`,
  `{"idle_every": [1]}`, `{"focus_brighten": {"dim": 1}}` → each warned, default kept), `ints_accepted_for_floats`
  (`{"figure_opacity": 1}` → 1.0), `not_an_object_warns`, `bad_json_warns`, `browser_home_is_unknown`.
  In `fsio.rs`: `write_replaces_whole_file`, `private_file_is_0600` (`#[cfg(unix)]`), `no_tmp_left_on_failure`
  (target in a missing read-only dir → returns false, no `.tmp` left).
- [ ] **Step 2: Run** `cargo test settings fsio`. Expected: FAIL (not defined).
- [ ] **Step 3: Implement.** Validation rules exactly as `magica-terminal:190-201` (bool only for bool; numbers for
  numbers; tuple = same-length list; set = list of ints; dict = known keys, merged into the default).
- [ ] **Step 4: Run** `cargo test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): settings and atomic writes`.

### Task 2: PTY manager and shell launch

**Files:**
- Create: `app/src-tauri/src/pty.rs`, `app/src-tauri/src/shell.rs`, `app/src-tauri/src/os/mod.rs`,
  `app/src-tauri/src/os/unix.rs`, `app/src-tauri/src/os/windows.rs`
- Create: `app/shell/bash/rc` (sources `~/.bashrc` if readable, then `../magica.bash`),
  `app/shell/zsh/.zshenv`, `.zprofile`, `.zshrc`, `.zlogin` (each sources the user's own file from
  `$MAGICA_USER_ZDOTDIR` (default `$HOME`) and `.zshrc` then sources `../magica.zsh`; they restore `ZDOTDIR` to the user's)
- Create: `app/src/ipc.ts`

**Interfaces:**
- Produces (Rust commands):
  - `pty_spawn(opts: SpawnOpts, on_output: Channel<InvokeResponseBody>, on_exit: Channel<i32>) -> Result<u32 /*pane id*/, String>`,
    `SpawnOpts { cwd: Option<String>, character: String, command: Option<Vec<String>>, resume: Option<String>, cols: u16, rows: u16, kyubey: bool }`.
    Output is sent as `InvokeResponseBody::Raw(bytes)` in chunks ≤64 KiB.
  - `pty_write(id: u32, data: String)`, `pty_resize(id: u32, cols: u16, rows: u16)`, `pty_kill(id: u32)`,
    `pty_pid(id: u32) -> Option<u32>`, `pty_foreground_pid(id: u32) -> Option<u32>` (Unix: `MasterPty::process_group_leader()`; Windows: `None`).
- Produces (Rust): `shell::command_for(shell: &ShellKind, opts: &SpawnOpts, shell_dir: &Path) -> CommandBuilder`;
  `enum ShellKind { Bash(PathBuf), Zsh(PathBuf), Pwsh(PathBuf), Other(PathBuf) }`; `shell::default_shell() -> ShellKind`
  (`$SHELL` on Unix, falling back to `/bin/sh`; Windows `pwsh.exe` on PATH else `powershell.exe`).
  Env always set: `MAGICA_APP=tauri`, `MAGICA_CHAR=<character>`, `MAGICA_SHELL_DIR=<resource dir>/shell`,
  `MAGICA_CONFIG=<config dir>`, `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=magica`; plus
  `MAGICA_RESUME` when `resume` is set.
  Argv: bash `bash --rcfile <shell>/bash/rc -i`; zsh `zsh -i` with `ZDOTDIR=<shell>/zsh`, `MAGICA_USER_ZDOTDIR=$ZDOTDIR or $HOME`;
  macOS adds login (`-l`) for both; pwsh `pwsh -NoLogo -NoExit -Command ". '<shell>/magica.ps1'"`;
  `command` given → that argv run directly (no integration); `Other` → plain interactive.
- Produces (TS `ipc.ts`): `spawnPane(opts: SpawnOpts, onData: (b: Uint8Array) => void, onExit: (code: number) => void): Promise<number>`,
  `writePane(id, data)`, `resizePane(id, cols, rows)`, `killPane(id)`.

- [ ] **Step 1: Failing tests** (`pty.rs`/`shell.rs`, Unix-gated where they spawn): `spawn_echo_reaches_channel`
  (spawn `command: ["sh","-c","printf hi"]` into a collector, expect `hi` and exit 0), `write_reaches_child`
  (`cat`, write `abc\n`, expect `abc`), `resize_changes_size` (`sh -c 'sleep 0.2; stty size'` after resize 100x30 → `30 100`),
  `big_output_is_chunked` (`head -c 5000000 /dev/zero | tr '\0' a` → total 5_000_000 bytes, no chunk > 65536),
  `bash_argv`, `zsh_env_has_zdotdir`, `pwsh_argv_dot_sources_script`, `missing_shell_falls_back` (`SHELL=/nonexistent` → `/bin/sh`).
- [ ] **Step 2: Run** `cargo test pty shell`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use a reader thread per pane; a pane map in Tauri `State<Mutex<HashMap<u32, Pane>>>`; on child
  exit send the code on `on_exit` and drop the pane. Spawn failure of the chosen shell retries once with the fallback and
  writes `magica: couldn't start <shell>: <err>\r\n` to the output first.
- [ ] **Step 4: Run** `cargo test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): PTY manager and shell launch`.

### Task 3: One terminal pane with theme and palette

**Files:**
- Create: `app/src/theme.ts`, `app/src/characters.ts`, `app/src/terminal.ts`
- Modify: `app/src/main.ts`, `app/src/style.css`
- Test: `app/src/theme.test.ts`

**Interfaces:**
- Produces: `characters.ts`: `type CharName = 'madoka'|'homura'|'sayaka'|'mami'|'kyoko'|'kyubey'`,
  `CHARACTERS: {name, icon, dark, light}[]` (values `magica-terminal:152-165`), `KYUBEY_GREYS` (`:166-169`), `slotOf(name): number`.
  `theme.ts`: `type ThemeName = 'dark'|'light'`, `THEMES` (`magica-terminal:226-235`), `desaturate(hex, amount)`,
  `mix(a, b, t)`, `xterm256(base16): string[]`, `palette(theme, s: Settings): string[]` (256 entries, slots filled as
  `magica-terminal:2732-2745`), `xtermTheme(theme, colour, focused, s): ITheme` (fg/cursor/selection as `:2746-2761`;
  background transparent).
  `terminal.ts`: `class TermView { term: Terminal; id: number; constructor(host: HTMLElement, opts: SpawnOpts, s: Settings); focus(); dispose(); fit(); }`
  loading fit, unicode11, search, web-links and webgl (try/catch → default renderer); writes output via `term.write(Uint8Array)`.

- [ ] **Step 1: Failing tests:** `desaturate('#ff9cc6', 0.55)` and `mix('#000000', '#ffffff', 0.5) === '#808080'`
  match the Python results (compute expected values by running the Python functions once and pasting them);
  `xterm256(THEMES.dark.palette).length === 256` and entry 16 `'#000000'`, 231 `'#ffffff'`, 232 `'#080808'`;
  `palette('dark', s)[100] === '#ff9cc6'`, `[101] === desaturate('#ff9cc6', 0.55)`, `[115] === '#f4f4f4'`, `[118] === '#8a8a8f'`;
  `palette('light', s)[118] === '#7a7a80'`.
- [ ] **Step 2: Run** `npm test theme`. Expected: FAIL.
- [ ] **Step 3: Implement** the module and wire `main.ts` to open one `TermView` filling the window with `PADDING` (10px).
  Theme from the `theme` file (`get_theme`/`set_theme` Rust commands; "system" → Tauri `window.theme()`).
- [ ] **Step 4: Run** `npm test`. Expected: PASS. Then `npm run tauri dev`: a shell prompt appears, typing works, `ls --color`
  shows colours, resizing the window reflows, `yes | head -c 50000000` finishes with the window still responsive.
- [ ] **Step 5: Commit** `feat(app): terminal pane with theme`.

### Task 4: Escape protocol and theme reporting

**Files:**
- Create: `app/src/protocol.ts`
- Test: `app/src/protocol.test.ts`

**Interfaces:**
- Produces: `type MagicaCmd = {verb:'set', name: CharName} | {verb:'layout', name:'pair'|'magica'} | {verb:'crush'} | {verb:'note'} | {verb:'space', path: string}`;
  `parseMagica(data: string): MagicaCmd | null`; `parseOsc7(data: string): string | null` (decoded local path; on Windows
  `file:///C:/x` → `C:\x`); `type Mark = {kind:'prompt'|'input'|'exec'} | {kind:'done', exit: number}`, `parseOsc133(data): Mark | null`;
  `install(term: Terminal, h: { onMagica(c), onCwd(p), onMark(m), reply(s: string), theme(): {fg, bg, dark: boolean} }): { themeChanged(): void }`
  registering OSC 9973, 7, 133 and 10/11 (`?` query → `OSC 10;rgb:rrrr/gggg/bbbb ST`), and CSI handlers for `?2031h/l`,
  `?2031$p` (DECRQM → `CSI ?2031;1|2$y`) and `?996n` (→ `CSI ?997;1n` dark / `2n` light). `themeChanged()` sends `?997` when
  2031 is on. Handlers for other modes return `false` so xterm.js handles them.

- [ ] **Step 1: Failing tests:** `parseMagica('set;homura')`, `('layout;magica')`, `('space;/tmp/a b;c')` → path `/tmp/a b;c`
  (everything after the first `;`), `('set;nobody')` → null, `('rm;-rf')` → null, `('x'.repeat(100000))` → null;
  `parseOsc7('file://host/home/u/My%20Files/Zo%C3%AB')` → `/home/u/My Files/Zoë`; `parseOsc133('D;1')` → done 1, `('D')` → done 0;
  using a headless `@xterm/headless` Terminal with `install`: `\x1b]11;?\x1b\\` replies with the bg colour,
  `\x1b[?2031h` then `themeChanged()` replies `\x1b[?997;1n` when dark, `\x1b[?2031$p` replies `\x1b[?2031;1$y` after enabling.
- [ ] **Step 2: Run** `npm test protocol`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): escape protocol and theme reporting`.

### Task 5: bash integration

**Files:**
- Create: `app/shell/magica.bash`
- Test: `app/shell/tests/env.test.ts` (shared fixture table used by Tasks 6 and 7), `app/shell/tests/bash.test.ts`

**Interfaces:**
- Consumes: protocol from Global Constraints.
- Produces: shell functions `madoka homura sayaka mami kyoko kyubey pair magica crush note space`; `.env` loader;
  `MAGICA_RESUME` handling. Test helper `runShell(kind: 'bash'|'zsh'|'pwsh', script: string, answers?: string): {stdout, stderr}`
  in `env.test.ts`, with the same HOME/proj/sub layout and env as `tests/test_env.py:11-33`.

- [ ] **Step 1: Failing tests.** Port the five tests in `tests/test_env.py` into a table run per shell (only `bash` enabled now);
  add `folder_with_space_and_unicode` (project at `pro j/Zoë` works and trust line is written with that folder).
  `bash.test.ts`: `homura` prints `\e]9973;set;homura\e\\`; `pair` prints `\e]9973;layout;pair\e\\`;
  prompt emits `OSC 133;A`, `OSC 7` with the cwd and, after `false`, `OSC 133;D;1`; `note buy milk` appends to
  `$MAGICA_CONFIG/note.txt` and prints `noted`; nothing is defined when `MAGICA_APP` is unset.
- [ ] **Step 2: Run** `npm test shell`. Expected: FAIL.
- [ ] **Step 3: Implement** by porting `shell/magica.bash` with these changes: gate on `MAGICA_APP=tauri`; slots
  hard-coded; titles replaced by OSC 9973 (no `sleep 0.1`); `PS0`/OSC 666 replaced by OSC 133 (`C` in PS0, `D;$?` before the
  prompt, `A` / `B` around PS1); OSC 7 each prompt; paths under `$MAGICA_CONFIG`; `kyubey` runs
  `sudo env MAGICA_APP=tauri MAGICA_CHAR=kyubey MAGICA_SHELL_DIR="$MAGICA_SHELL_DIR" MAGICA_CONFIG="$MAGICA_CONFIG" bash --rcfile "$MAGICA_SHELL_DIR/bash/rc" -i`
  after sending `set;kyubey`, and sends `set;$MAGICA_CHAR` when it returns; the script's kyubey branch draws the root
  prompt as `shell/root-prompt.sh` does. `magica-terminal --crush` / `--note` inside a pane are handled by the binary (Task 17).
- [ ] **Step 4: Run** `npm test shell`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): bash integration`.

### Task 6: zsh integration

**Files:**
- Create: `app/shell/magica.zsh`
- Modify: `app/shell/tests/env.test.ts` (enable `zsh`)
- Test: `app/shell/tests/zsh.test.ts` (same cases as `bash.test.ts`)

- [ ] **Step 1:** Enable zsh in the table and add `zsh.test.ts`. Run `npm test shell`. Expected: zsh cases FAIL.
- [ ] **Step 2: Implement** the same behaviour with `precmd`/`preexec` hooks (`add-zsh-hook`), `PROMPT` with `%{…%}`,
  zsh arrays (1-based) and `typeset -gA`. `kyubey` as in bash but `zsh -i` with `ZDOTDIR=$MAGICA_SHELL_DIR/zsh`.
- [ ] **Step 3: Run** `npm test shell`. Expected: PASS for bash and zsh.
- [ ] **Step 4: Commit** `feat(app): zsh integration`.

### Task 7: PowerShell integration

**Files:**
- Create: `app/shell/magica.ps1`
- Modify: `app/shell/tests/env.test.ts` (enable `pwsh`)
- Test: `app/shell/tests/pwsh.test.ts`

- [ ] **Step 1:** Enable pwsh and add `pwsh.test.ts`. Run. Expected: pwsh cases FAIL.
- [ ] **Step 2: Implement.** `prompt` function wraps the user's existing prompt; exit status from `$?`/`$LASTEXITCODE`;
  `PSConsoleHostReadLine` wrapper (PSReadLine) emits `OSC 133;C`; `.env` sets/restores `$env:` variables (no shell-only
  variables in PowerShell: "was only a shell variable" maps to "was unset"); answers read with `Read-Host`; `kyubey` tries
  `sudo` (Windows 11) then `gsudo`, running `pwsh -NoLogo -NoExit -Command ". '$env:MAGICA_SHELL_DIR\magica.ps1'"` with
  `MAGICA_CHAR=kyubey`; if neither exists prints `kyubey needs Windows' sudo (Settings → System → For developers) or gsudo`.
  `.env` parsing must match bash exactly; the shared table proves it.
- [ ] **Step 3: Run** `npm test shell`. Expected: PASS for all three.
- [ ] **Step 4: Commit** `feat(app): PowerShell integration`.

### Task 8: Panes, tabs, splits, layouts, title bar, keys

**Files:**
- Create: `app/src/layout.ts` (pure split-tree model), `app/src/window.ts` (DOM: tabs, splits with draggable dividers, title bar),
  `app/src/pane.ts` (a pane: `TermView` + character + overlays), `app/src/keys.ts`
- Test: `app/src/layout.test.ts`, `app/src/keys.test.ts`

**Interfaces:**
- Produces: `layout.ts`: `type Node = {kind:'pane', id: number} | {kind:'split', orient:'h'|'v', ratio: number, a: Node, b: Node}`;
  `split(root, paneId, orient, newId): Node`; `remove(root, paneId): Node | null`; `neighbour(rects: Map<number, DOMRect>, from: number, dx, dy): number | null`
  (nearest pane whose rect lies in that direction, overlapping on the other axis, as `magica-terminal:3325-3349`);
  `build(spec: LayoutSpec, ids: () => number): Node` with equal splits (3 panes → ratios 1/3 then 1/2; `magica-terminal:3179-3200`);
  `LAYOUTS` (`:140-143`).
  `keys.ts`: `type Action = 'splitRight'|'splitDown'|'close'|'newTab'|'prevTab'|'nextTab'|{tab: number}|'copy'|'paste'|'fontUp'|'fontDown'|'fontReset'|'toggleTheme'|'search'|{move:[number,number]}`;
  `actionFor(e: KeyboardEvent, os: 'mac'|'other'): Action | null`.
  `Pane`: `character`, `cwd`, `focused`, `setCharacter(name)`, `onMagica(cmd)`, events `exit`.
  `Window`: `newTab(cwd?, character?)`, `split(orient)`, `closePane(pane)`, `applyLayout(pane, name)`, `setTheme(t)`,
  `setFontScale(k)`, `panes()`, `serialize()` / `restore()` (Task 11).

- [ ] **Step 1: Failing tests:** `split` then `remove` returns the original; removing the last pane gives `null`;
  `build(LAYOUTS.magica)` has 5 panes with ratios `[0.5, 0.5, 1/3, 0.5]` in tree order; `neighbour` picks the right pane in a 2×3 grid;
  `actionFor(ctrl+shift+O, 'other') === 'splitRight'`, `(meta+D, 'mac') === 'splitRight'`, `(meta+shift+D, 'mac') === 'splitDown'`,
  `(ctrl+9, 'other')` → `{tab: 9}`, `(ctrl+C, 'mac') === null` (Ctrl goes to the program), `(alt+B, 'mac') === null`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Tab bar and custom title bar as the Python app (`magica-terminal:3004-3160`, `:3350-3411`;
  title = coloured dot + `name@magica` + folder; macOS leaves 72px for the traffic lights; `WINDOW_RADIUS` bottom corners via CSS).
  Focused-pane tint and unfocused desaturation as `:2746-2795`. `layout` command: as `:3160-3178` (new tab if current is split).
  macOS: xterm `macOptionIsMeta: true`. Close-pane keys first close an overlay (game, notes, space, search) if one is open.
  Exiting a pane's shell closes the pane; the last pane closes the window.
- [ ] **Step 4: Run** `npm test`; then in `tauri dev`: split both ways, move focus, close, tabs 1–9, `pair`, `magica`,
  `homura` recolours the pane, Ctrl+Shift+L flips the theme and Claude Code (`/theme` auto) follows.
- [ ] **Step 5: Commit** `feat(app): panes, tabs, layouts, keys`.

### Task 9: Figures and reactions

**Files:**
- Create: `app/src/figure.ts` (DOM + animation), `app/src/cover.ts` (pure maths)
- Test: `app/src/cover.test.ts`, `app/src/figure.test.ts`

**Interfaces:**
- Produces: `cover.ts`: `figureBox(paneW, paneH, imgW, imgH, s: Settings, anim: {stretch, widen, hop}): {x, y, w, h, scale}`
  (port `magica-terminal:2966-2990`, scale `max(w/1920, h/1080)`, kyubey has no bottom margin);
  `solidSpans(alpha: Uint8ClampedArray, w, h): ([number, number] | null)[]` (alpha > 64);
  `coverFraction(spans, origin: {x, y}, cell: {w, h, cols, rows}, inked: (row, col) => boolean): number` (`:2815-2850`);
  `cellInked(cell: IBufferCell, fg: string, bg: string, contrast: number): boolean` (text that is not whitespace and differs from its
  cell colour, or a cell background differing from the theme bg, by more than `TEXT_CONTRAST`; see `cell_inks` `:824-847`).
  `hopOffset(t, height, hops)`, `squashAt(t, amount): {stretch, widen}`, `breathAt(t, amount)` (formulas `:2656-2668`, `:2888-2917`).
  `figure.ts`: `class Figure { constructor(pane); onCommandDone(exit: number, took: number, watched: boolean); setHover(b); setCover(f); tickIdle(); }`.
- [ ] **Step 1: Failing tests:** port the seven tests of `tests/test_cover.py` to `cellInked` (feeding cells built with
  `@xterm/headless` from the same strings with SGR colours); `figureBox` at 1920×1080 gives height 240, right 30, bottom 12, and
  at 960×1080 the same size (height still full); `hopOffset(0.5/3, 22, 3)` peaks at 22; `squashAt(0.15, 0.15).stretch === 0.85`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Figure as an absolutely positioned `<canvas>` behind the transparent xterm; red tint by drawing
  `FAIL_RED` with `globalCompositeOperation='source-atop'` at `FAIL_TINT`; base bar under the focused figure; opacity
  `FIGURE_OPACITY` × hover × cover fades (`:2791-2796`); cover check at most every 100 ms. Reactions on `OSC 133;D` per
  `:2852-2873` (start time from `C`; `IGNORED_EXIT`; long command + unwatched → hops and, if the window isn't focused and
  `NOTIFY`, a notification titled with her name and body `finished after 1m 5s (exit 2)`); idle per `:2646-2655`. Hidden under game/notes.
- [ ] **Step 4: Run** `npm test`; manual: `false` squashes red, `true` jumps, `sleep 11` in an unfocused pane hops 3×.
- [ ] **Step 5: Commit** `feat(app): figures and reactions`.

### Task 10: Search, links, clipboard, font size

**Files:**
- Create: `app/src/search.ts`, `app/src/links.ts`; Rust command `path_exists(path: String, cwd: Option<String>) -> Option<String>` in `app/src-tauri/src/files.rs`
- Test: `app/src/links.test.ts`

**Interfaces:**
- Produces: `findLinks(line: string): {start, end, text, kind:'url'|'path'}[]` using `LINK_REGEXES` (`magica-terminal:131-136`,
  translated to JS regex with lookbehind); `~` expands to home; relative paths resolved against the pane cwd.
- [ ] **Step 1: Failing tests:** `https://a.b/c).` → `https://a.b/c`; `www.x.org/p,` → `www.x.org/p`; `see /etc/hosts.` → `/etc/hosts`;
  `~/My` → path; `a/b` (no leading `/`) → no match.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** xterm `registerLinkProvider` with these, Ctrl-click (Cmd on mac) opens via opener plugin; paths only if
  `path_exists`; OSC 8 via xterm's `linkHandler`. Search bar (`:2930-2965`: Enter older, Shift+Enter newer, Esc closes) using
  the search addon. Copy/paste through the clipboard plugin; font scale ×1.1 / ÷1.1 / reset, applied to all panes.
- [ ] **Step 4: Run** `npm test`; manual checks of each.
- [ ] **Step 5: Commit** `feat(app): search, links, clipboard, font size`.

### Task 11: Session save/restore and agent resume

**Files:**
- Create: `app/src-tauri/src/session.rs`, `app/src-tauri/src/agents.rs`, `app/src-tauri/src/instance.rs`; `app/src/session.ts`
- Test: inline Rust tests; `app/src/session.test.ts`

**Interfaces:**
- Produces (Rust): `agents::agent_in(argv: &[String]) -> Option<&'static str>` (`magica-terminal:391-403`);
  `agents::claude_session(shell_pid: u32, sessions_dir: &Path, procs: &ProcTable) -> Option<(String, Option<String>)>` (`:356-372`);
  `agents::foreground_agent(fg_pid: Option<u32>, shell_pid: u32, procs: &ProcTable) -> Option<&'static str>` (Unix: argv of `fg_pid`;
  Windows: the first descendant whose argv is an agent); `ProcTable` built from `sysinfo` (pid → ppid, argv).
  Commands: `pane_resume(id: u32) -> Option<ResumeInfo { resume: String, cwd: Option<String> }>`, `load_session() -> Option<serde_json::Value>`
  (None if missing, corrupt, or `instance::other_running()`), `save_session(json: String)`, `clear_session()`.
  `instance::other_running() -> bool` (another process whose exe name is `BIN_NAME`, not us).
- Produces (TS): `restoredText(history: string, lines = 2000): string` (`:327-335`), `historyText(term: Terminal): string`
  (normal buffer: scrollback + screen; alternate buffer active: its screen; last 2000 lines, trailing blank trimmed),
  `serialize(win): SessionJson`, `restore(win, json)`. Format identical to `magica-terminal:3201-3237` (`size`, `current`,
  `tabs`; nodes `{char, cwd, text|resume}` / `{orient, ratio, a, b}`; old `claude` key still read).
- [ ] **Step 1: Failing tests:** port `tests/test_session.py` (restored text ×4, round trip, claude found/none/bad id,
  resumes once / others take latest / ignores anything else, foreground, argv) to Rust (`agents`, using a fake `ProcTable`)
  and TS (`restoredText`, round trip). Add `corrupt_session_is_ignored` (truncated JSON → `None`), `old_python_session_loads`
  (a sample written by the Python app, saved as a fixture), `unicode_cwd_round_trips`, `kyubey_pane_restores_as_madoka`.
- [ ] **Step 2: Run** both suites. Expected: FAIL.
- [ ] **Step 3: Implement.** Close: JS `onCloseRequested` → `preventDefault`, serialize (per pane `pane_resume` first; agent →
  `resume` instead of `text`), `save_session`, then `destroy()`. Last shell exits → `clear_session`. Restore at start before
  creating the default tab; missing cwd → home; `resume` → `SpawnOpts.resume` (shell script runs it at the first prompt,
  as `shell/magica.bash:123-139`).
- [ ] **Step 4: Run** suites. Expected: PASS. Manual: two tabs, split, `homura`, `vim`, close, reopen; Claude Code resumes.
- [ ] **Step 5: Commit** `feat(app): session save and restore`.

### Task 12: Crush rules

**Files:**
- Create: `app/src/crush/board.ts`
- Test: `app/src/crush/board.test.ts`

**Interfaces:**
- Produces: `class Tile`, `class Step`, `class CrushBoard` with the same methods and semantics as `magica-terminal:450-812`
  (`constructor({size, kinds, rng, luck, stripes, fade})`, `fresh`, `runs`, `groups`, `swap(a,b)`, `resolve`, `gravity`, `moves`,
  `hint`, `bestMove`, `shuffle`), `rng: () => number` injectable (seeded `mulberry32(seed)` exported for tests).
- [ ] **Step 1: Failing tests:** port all 20 tests of `tests/test_crush.py` one to one.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the port.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(app): Crush rules`.

### Task 13: Crush view

**Files:**
- Create: `app/src/crush/view.ts`, `app/src/crush/sprites.ts`; Rust commands `read_json(name)`/`write_json(name, text)` in `files.rs`
  restricted to `crush.json`
- Test: `app/src/crush/sprites.test.ts`

**Interfaces:**
- Consumes: `CrushBoard` (Task 12), `Pane.openOverlay(el)/closeOverlay()` (Task 8).
- Produces: `openCrush(pane, s: Settings): Overlay`; `gemPixels(kind, special)`, `kyubeyPixels()` (`magica-terminal:815-912`).
- [ ] **Step 1: Failing test:** `gemPixels(0, null)` equals the Python output (paste it as a fixture); garbage `crush.json` → best 0.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the view on a `<canvas>` porting `magica-terminal:915-1476` (input, phases/animation queue,
  effects, text pops, hint after `CRUSH_HINT_AFTER`, `A` autoplay with `CRUSH_AUTOPLAY_DELAY`, Esc/q close, best score rules).
- [ ] **Step 4: Run** `npm test`; manual: `crush`, play, make each special, autoplay, best score persists.
- [ ] **Step 5: Commit** `feat(app): Crush view`.

### Task 14: Notepad

**Files:**
- Create: `app/src/notes/markup.ts`, `app/src/notes/view.ts`; Rust commands `read_note() -> String`, `write_note(text)` in `files.rs`
- Test: `app/src/notes/markup.test.ts`

**Interfaces:**
- Produces: `noteMarks(text): {heads: Mark[], bolds: Mark[]}` with `Mark = {start, end, innerStart, innerEnd}` (regexes
  `NOTE_HEAD`/`NOTE_BOLD` in `magica-terminal`); `openNotes(pane, s): Overlay`.
- [ ] **Step 1: Failing tests:** port `tests/test_note.py` (headers, one-line headers, bold, bullets not bold; the two
  view tests become tests of a pure `visibleTags(marks, cursor)` and `jumpTarget(heads, n)`).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** with CodeMirror 6: decorations hide tags unless the selection touches the mark; header style
  (larger, bold, underlined) and bold; header list on the left jumps (header to the top); save `NOTE_SAVE_AFTER` after typing and
  on Ctrl/Cmd+S; undo/redo keys; Esc closes; the window is always-on-top while any notepad is open (`setAlwaysOnTop`).
- [ ] **Step 4: Run** `npm test`; manual: `note`, edit, reopen, `note buy milk`.
- [ ] **Step 5: Commit** `feat(app): notepad`.

### Task 15: `space`

**Files:**
- Create: `app/src-tauri/src/scan.rs`, `app/src/space.ts`
- Test: inline Rust tests; `app/src/space.test.ts`

**Interfaces:**
- Produces (Rust): `scan_start(path: String, inside: Option<u32>, on_update: Channel<ScanUpdate>) -> u32` (scan id),
  `scan_stop(id)`, `ScanUpdate { node: u32, parent: Option<u32>, name: String, folder: bool, size: u64, listed: bool, error: Option<String> }`
  batched every ≥100 ms; size = allocated blocks×512 on Unix, file length on Windows; hard links once (Unix dev+ino); stays on one
  filesystem (Unix `dev`; Windows volume of the root); `open_path(path)` via opener.
- Produces (TS): `humanSize(n): string` (`magica-terminal:1603-1608`), `openSpace(pane, path): Overlay`.
- [ ] **Step 1: Failing tests:** port `tests/test_space.py` (sizes match `du -sB1` on Unix, hard links once, going up keeps the
  scanned folder, unreadable folder, units) plus `unicode_folder_with_space`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**; view as `magica-terminal:1699-1890` (rows with bars, biggest first, click/double-click,
  Backspace up past the start, C sends `cd -- '<path>'\r` (PowerShell: `Set-Location -LiteralPath '<path>'`), Esc/q).
- [ ] **Step 4: Run** suites; manual `space ~`.
- [ ] **Step 5: Commit** `feat(app): space`.

### Task 16: `kyubey` end to end

**Files:**
- Modify: `app/src/pane.ts`, `app/src/figure.ts`

- [ ] **Step 1:** Manual test on Linux under bash and zsh: `kyubey` asks for the sudo password, the pane turns Kyubey
  (greys, red accent, root prompt), `exit` brings the character back; wrong password leaves the character unchanged.
  Fix whatever fails (Kyubey without `figures/kyubey.png` shows no figure).
- [ ] **Step 2: Commit** `fix(app): kyubey`.

### Task 17: Command line

**Files:**
- Create: `app/src-tauri/src/cli.rs`
- Test: inline

**Interfaces:**
- Produces: `cli::parse(args: &[String], in_pane: bool) -> Cli` with `enum Cli { Window { overlay: Option<Overlay>, command: Option<Vec<String>> }, InPane(Overlay) }`,
  `enum Overlay { Crush, Note }`; `in_pane` = `MAGICA_APP` set. `InPane` prints `OSC 9973;crush|note ST` to stdout and exits.
- [ ] **Step 1: Failing tests:** `[]` → window; `["--crush"]` → window with Crush; `["-e","htop"]` and `["--","htop"]` and
  `["htop","-d","5"]` → command; `["--note"]` with `in_pane` → `InPane(Note)`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement**, wiring the first pane's `command` and overlay.
- [ ] **Step 4: Run.** Expected: PASS. **Step 5: Commit** `feat(app): command line`.

### Task 18: Installers and cross-OS checks

**Files:**
- Create: `app/install.sh`, `app/install.ps1`, `docs/os-checklist.md`

- [ ] **Step 1: `install.sh`** (Linux, macOS): check `cargo`, `node`/`npm`, Linux WebKitGTK (`pkg-config webkit2gtk-4.1`; on Ubuntu
  offer the apt line from Task 0, elsewhere print the package names), macOS `xcode-select -p`; `npm ci && npm run tauri build -- --no-bundle`
  on Linux (`--bundles app` on macOS); install the binary to `~/.local/bin/<BIN_NAME>` and the `.desktop` file (Linux), or the `.app`
  to `~/Applications` plus a `~/.local/bin` symlink (macOS); `--default` as `install.sh:51-55` (Linux only). Idempotent.
- [ ] **Step 2: `install.ps1`**: check `cargo`, `node`, MSVC (`vswhere`); build; copy to `%LOCALAPPDATA%\Programs\magica-terminal`,
  add to user PATH, Start Menu shortcut. Idempotent.
- [ ] **Step 3:** Run `app/install.sh` on this machine. Expected: `magica-dev` launches from the menu and PATH.
- [ ] **Step 4:** `cargo check --target x86_64-pc-windows-msvc` and `--target aarch64-apple-darwin`. Expected: success (or the
  limitation recorded in Task 0 still applies; list it in the checklist).
- [ ] **Step 5:** Write `docs/os-checklist.md`: for macOS and Windows, one checkbox per spec parity item, written as an
  action and expected result (e.g. "`false` → she squashes red"), with install steps at the top.
- [ ] **Step 6: Commit** `feat(app): installers and OS checklist`.

### Task 19: Cutover (after the owner's macOS/Windows pass and fixes)

**Files:**
- Modify: `paths.rs` (`BIN_NAME = "magica-terminal"`, `APP_DIR_NAME = "magica-terminal"`), `Cargo.toml` bin name
- Move: `app/install.sh` → `install.sh`, `app/install.ps1` → `install.ps1`, `app/public/figures` (and drop `figures/`)
- Delete: `magica-terminal`, `magica-terminal.desktop` (replaced), `windows/`, `gnome-extension/`, `shell/`, `tests/`, `__pycache__/`
- Rewrite: `README.md`

- [ ] **Step 1:** Make the changes above; the installer also removes the old `~/.bashrc` line that sources `shell/magica.bash` and the
  old GNOME extension link if present.
- [ ] **Step 2:** `npm test`, `cargo test`, `./install.sh`. Expected: all pass; the old `session.json` restores in the new app.
- [ ] **Step 3:** README: what it is, install per OS, keys table (both columns), shell commands, settings, Wayland always-on-top note.
- [ ] **Step 4: Commit** `feat: replace the Python and Electron apps with the Tauri app`.
