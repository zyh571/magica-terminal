// Runs Magica's shell scripts in a plain bash / zsh / pwsh for the tests, with a throwaway HOME.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export type Kind = "bash" | "zsh" | "pwsh";
export const SHELL_DIR = resolve(__dirname, "..");

const WIN = process.platform === "win32";

/** The executable for a kind. On Windows the app falls back to Windows PowerShell when pwsh 7 is missing; so do we. */
export function exe(kind: Kind): string {
  if (kind === "pwsh" && WIN && !runs("pwsh")) return "powershell";
  return kind;
}

function runs(cmd: string): boolean {
  const args = /pwsh|powershell/.test(cmd) ? ["-NoProfile", "-Command", "1"] : ["--version"];
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}

/** What Windows programs need to find each other (`cmd` → cmd.exe needs PATHEXT; PowerShell needs SystemRoot). */
const WIN_ENV: Record<string, string> = WIN
  ? Object.fromEntries(["SystemRoot", "windir", "PATHEXT", "ComSpec"].map((k) => [k, process.env[k] ?? ""]))
  : {};

/** A PowerShell command that fails with exit status 1 (Windows has no `false`). */
export const PWSH_FAIL = WIN ? "& cmd /c exit 1" : "& false";

/** Puts a fake agent on PATH: `<bin>/<name>` prints its name and arguments. Returns the PATH to use. */
export function fakeAgent(bin: string, name: string): string {
  if (WIN) writeFileSync(join(bin, `${name}.cmd`), `@echo ${name} %*\r\n`);
  else writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*"\n`, { mode: 0o755 });
  return `${bin}${delimiter}${process.env.PATH}`;
}

/** Whether a kind's tests can run here. On Windows the app only runs PowerShell (Git Bash would report MSYS paths). */
export function have(kind: Kind): boolean {
  if (WIN && kind !== "pwsh") return false;
  return runs(exe(kind));
}

export interface Sandbox {
  root: string;
  home: string;
  proj: string;
  config: string;
  run(kind: Kind, script: string, answers?: string, extraEnv?: Record<string, string>): { stdout: string; stderr: string };
  done(): void;
}

export function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "magica-shell-"));
  const home = join(root, "home"), proj = join(root, "proj"), config = join(home, ".config", "magica-terminal");
  mkdirSync(join(proj, "sub"), { recursive: true });
  mkdirSync(home, { recursive: true });
  return {
    root, home, proj, config,
    run(kind, script, answers = "", extraEnv = {}) {
      const env = {
        HOME: home, PATH: process.env.PATH!, MAGICA_APP: "tauri", MAGICA_CHAR: "madoka", MAGICA_CONFIG: config,
        MAGICA_SHELL_DIR: SHELL_DIR, KEEP: "outer", TERM: "xterm-256color", LANG: "C.UTF-8", ...WIN_ENV, ...extraEnv,
      };
      const argv: Record<Kind, string[]> = {
        bash: ["bash", "--norc", "--noprofile", "-c", `. "${SHELL_DIR}/magica.bash"\n${script}`],
        zsh: ["zsh", "-f", "-c", `. "${SHELL_DIR}/magica.zsh"\n${script}`],
        pwsh: [exe("pwsh"), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `. '${SHELL_DIR}/magica.ps1'\n${script}`],
      };
      const [cmd, ...args] = argv[kind];
      const r = spawnSync(cmd, args, { input: answers, cwd: root, env, encoding: "utf8", timeout: 20000 });
      return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    done() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
