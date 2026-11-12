// What every shell script must do, run against bash / zsh / pwsh (each test file calls shellCases for its shell).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { have, Kind, sandbox, Sandbox } from "./run";

const OSC = (s: string) => `\x1b]${s}\x1b\\`;

/** A command line that runs the prompt hooks as the shell would before showing a prompt, and prints the prompt. */
function prompt(kind: Kind): string {
  if (kind === "bash") return 'eval "$PROMPT_COMMAND"; printf "%s" "${PS1@P}"';
  if (kind === "zsh") return 'for f in $precmd_functions; do $f; done; print -rn -- "${(%%)PROMPT}"';
  return "Write-Output (prompt)";
}
function fail(kind: Kind): string {
  return kind === "pwsh" ? "$global:LASTEXITCODE = 1; $global:_magica_test_ok = $false" : "false";
}

export function shellCases(kind: Kind) {
  describe.skipIf(!have(kind))(`${kind} protocol`, () => {
    let sb: Sandbox;
    beforeEach(() => (sb = sandbox()));
    afterEach(() => sb.done());
    const run = (s: string, env?: Record<string, string>) => {
      const r = sb.run(kind, s, "", env);
      expect(r.stderr).toBe("");
      return r.stdout;
    };

    test("character commands", () => {
      expect(run("homura")).toContain(OSC("9973;set;homura"));
      expect(run("madoka")).not.toContain("9973");   // already her
    });
    test("layouts become madoka", () => {
      const out = run("homura; pair");
      expect(out).toContain(OSC("9973;layout;pair"));
      expect(run("magica")).toContain(OSC("9973;layout;magica"));
    });
    test("crush, note and space", () => {
      expect(run("crush")).toContain(OSC("9973;crush"));
      expect(run("note")).toContain(OSC("9973;note"));
      const d = join(sb.root, "a b");
      mkdirSync(d);
      expect(run(kind === "pwsh" ? `space '${d}'` : `space '${d}'`)).toContain(OSC(`9973;space;${d}`));
    });
    test("space on a missing folder says so", () => {
      const r = sb.run(kind, "space /nonexistent/x");
      expect(r.stdout + r.stderr).toContain("space: no such folder");
      expect(r.stdout).not.toContain("9973");
    });
    test("note with words appends a line", () => {
      const out = run("note buy milk; note 'and eggs'");
      expect(out).toContain("noted");
      expect(readFileSync(join(sb.config, "note.txt"), "utf8")).toBe("buy milk\nand eggs\n");
    });
    test("prompt reports status, folder and marks", () => {
      const out = run(`${fail(kind)}\n${prompt(kind)}`);
      expect(out).toContain(OSC("133;D;1"));
      expect(out).toContain(`\x1b]7;file://`);
      expect(out).toMatch(new RegExp(`\\x1b\\]7;file://[^/]*${sb.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\x1b\\\\`));
      expect(out).toContain(OSC("133;A"));
      expect(out).toContain(OSC("133;B"));
      expect(out).toContain("madoka@magica");
    });
    test("folder in OSC 7 is percent-encoded", () => {
      const d = join(sb.root, "a b", "Zoë");
      mkdirSync(d, { recursive: true });
      const cd = kind === "pwsh" ? `Set-Location -LiteralPath '${d}'` : `cd '${d}'`;
      const out = run(`${cd}\n${prompt(kind)}`);
      expect(out).toContain("/a%20b/Zo%C3%AB\x1b\\");
    });
    test("nothing outside Magica Terminal", () => {
      const r = sb.run(kind, kind === "pwsh" ? "Get-Command homura -ErrorAction SilentlyContinue | Out-String" : "type homura 2>&1 || true", "", { MAGICA_APP: "" });
      expect(r.stdout).not.toContain("9973");
      expect(r.stdout).not.toMatch(/homura is a (shell )?function|Function\s+homura/);
    });
    test("resume runs the agent once", () => {
      const bin = join(sb.root, "bin");
      mkdirSync(bin);
      const fake = join(bin, kind === "pwsh" ? "codex" : "codex");
      require("node:fs").writeFileSync(fake, '#!/bin/sh\necho "codex $*"\n', { mode: 0o755 });
      const out = run(`${prompt(kind)}\n${prompt(kind)}`, { PATH: `${bin}:${process.env.PATH}`, MAGICA_RESUME: "codex" });
      expect(out.split("codex resume --last").length - 1).toBe(1);
    });
    test("resume ignores a bad claude id", () => {
      const out = run(prompt(kind), { MAGICA_RESUME: "claude:not-a-uuid; rm -rf /" });
      expect(out).not.toContain("claude");
      expect(existsSync(sb.root)).toBe(true);
    });
  });
}
