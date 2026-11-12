// Runs Magica's shell scripts in a plain bash / zsh / pwsh for the tests, with a throwaway HOME.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type Kind = "bash" | "zsh" | "pwsh";
export const SHELL_DIR = resolve(__dirname, "..");

export function have(kind: Kind): boolean {
  return spawnSync(kind, ["--version"], { stdio: "ignore" }).status === 0;
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
        MAGICA_SHELL_DIR: SHELL_DIR, KEEP: "outer", TERM: "xterm-256color", LANG: "C.UTF-8", ...extraEnv,
      };
      const argv: Record<Kind, string[]> = {
        bash: ["bash", "--norc", "--noprofile", "-c", `. "${SHELL_DIR}/magica.bash"\n${script}`],
        zsh: ["zsh", "-f", "-c", `. "${SHELL_DIR}/magica.zsh"\n${script}`],
        pwsh: ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `. '${SHELL_DIR}/magica.ps1'\n${script}`],
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
