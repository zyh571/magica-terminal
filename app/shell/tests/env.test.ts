// A folder's .env, the same in every shell: one table of steps, translated into bash, zsh and PowerShell.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { exe, have, Kind, PWSH_FAIL, sandbox, Sandbox } from "./run";

type Step =
  | ["cd", string]          // a folder (relative to the sandbox root, or absolute)
  | ["env"]                 // what runs before every prompt
  | ["show", ...string[]]   // prints [v1|v2|…], "unset" for unset variables
  | ["child", string]       // a child process prints child=<value or unset>
  | ["false"]
  | ["status"]              // prints s=<last exit status>
  | ["setlocal", string, string]  // a shell variable (bash/zsh: not exported; pwsh: $env:)
  | ["write", string, string]     // overwrite a file (relative to the current folder)
  | ["sleep", number];

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const pq = (s: string) => `'${s.replace(/'/g, "''")}'`;

function script(kind: Kind, steps: Step[], root: string): string {
  const abs = (p: string) => (isAbsolute(p) ? p : join(root, p));
  return steps.map((s) => {
    if (kind === "pwsh") {
      switch (s[0]) {
        case "cd": return `Set-Location -LiteralPath ${pq(abs(s[1]))}`;
        case "env": return `_magica_env`;
        case "show": return `Write-Output ('[' + ((@(${s.slice(1).map((k) => pq(k)).join(",")}) | ForEach-Object { $v = [Environment]::GetEnvironmentVariable($_); if ($null -eq $v) { 'unset' } else { $v } }) -join '|') + ']')`;
        case "child": return `${exe("pwsh")} -NoProfile -Command ${pq(`$v = $env:${s[1]}; if ($null -eq $v) { $v = 'unset' }; Write-Output "child=$v"`)}`;
        case "false": return PWSH_FAIL;
        case "status": return `Write-Output "s=$global:LASTEXITCODE"`;
        case "setlocal": return `$env:${s[1]} = ${pq(s[2])}`;
        case "write": return `[IO.File]::WriteAllText((Join-Path (Get-Location) ${pq(s[1])}), ${pq(s[2])})`;
        case "sleep": return `Start-Sleep -Milliseconds ${s[1] * 1000}`;
      }
    }
    switch (s[0]) {
      case "cd": return `cd ${q(abs(s[1]))}`;
      case "env": return `_magica_env`;
      case "show": return `printf '[%s]\\n' "${s.slice(1).map((k) => `\${${k}-unset}`).join("|")}"`;
      case "child": return `sh -c 'echo "child=\${${s[1]}-unset}"'`;
      case "false": return `false`;
      case "status": return `echo "s=$?"`;
      case "setlocal": return `${s[1]}=${q(s[2])}`;
      case "write": return `printf '%s' ${q(s[2])} > ${q(s[1])}`;
      case "sleep": return `sleep ${s[1]}`;
    }
  }).join("\n");
}

const SHELLS: Kind[] = ["bash", "zsh", "pwsh"];

for (const kind of SHELLS) {
  describe.skipIf(!have(kind))(`.env in ${kind}`, () => {
    let sb: Sandbox;
    beforeEach(() => (sb = sandbox()));
    afterEach(() => sb.done());
    const env = (text: string, where = sb.proj) => writeFileSync(join(where, ".env"), text);
    const run = (steps: Step[], answers = "") => {
      const r = sb.run(kind, script(kind, steps, sb.root), answers);
      expect(r.stderr).toBe("");
      return r.stdout;
    };
    const count = (s: string, sub: string) => s.split(sub).length - 1;

    test("asks, loads and unloads", () => {
      env("# keys\nexport API_KEY=abc123\nDB_URL = 'postgres://x#y'\nQ=\"a \\\"b\\\"\\nc\"  # note\nPLAIN=v # c\nbad line\nKEEP=inner\n");
      const out = run([["cd", "proj"], ["env"], ["show", "API_KEY", "DB_URL", "Q", "PLAIN", "KEEP"], ["child", "API_KEY"],
        ["cd", "proj/sub"], ["env"], ["show", "API_KEY", "DB_URL", "KEEP"]], "y\n");
      expect(out).toContain("load .env here? (API_KEY, DB_URL, Q, PLAIN, KEEP) [y/n]");
      expect(out).toContain("loaded .env: API_KEY, DB_URL, Q, PLAIN, KEEP");
      expect(out).toContain('[abc123|postgres://x#y|a "b"\nc|v|inner]');
      expect(out).toContain("child=abc123");
      expect(out).toContain("unloaded .env");
      expect(out).toContain("[unset|unset|outer]");
      expect(out).not.toContain("abc123\x1b");
      expect(readFileSync(join(sb.config, "env-trust"), "utf8")).toBe(`y\t${sb.proj}\n`);
    });

    test("remembers answers", () => {
      env("A=1\n");
      let out = run([["cd", "proj"], ["env"], ["cd", "."], ["env"], ["cd", "proj"], ["env"], ["show", "A"]], "y\n");
      expect(count(out, "load .env here?")).toBe(1);
      expect(out).toContain("[1]");
      const other = join(sb.root, "other");
      mkdirSync(other);
      env("B=2\n", other);
      out = run([["cd", "other"], ["env"], ["cd", "."], ["env"], ["cd", "other"], ["env"], ["show", "B"]], "n\n");
      expect(count(out, "load .env here?")).toBe(1);
      expect(out).toContain("[unset]");
    });

    test("no answer asks again only after coming back", () => {
      env("A=1\n");
      const out = run([["cd", "proj"], ["env"], ["env"], ["cd", "."], ["env"], ["cd", "proj"], ["env"], ["show", "A"]], "\n");
      expect(count(out, "load .env here?")).toBe(2);
      expect(out).toContain("[unset]");
    });

    test("reloads after an edit and restores what was there", () => {
      env("A=1\nLOCAL=from-env\n");
      const out = run([["setlocal", "LOCAL", "mine"], ["cd", "proj"], ["env"], ["show", "A"],
        ["sleep", 1.1], ["write", ".env", "A=2\n"], ["env"], ["show", "A", "LOCAL"],
        ["cd", "/"], ["env"], ["show", "A", "LOCAL"], ["child", "LOCAL"]], "y\n");
      expect(out).toContain("[1]");
      expect(out).toContain("reloaded .env: A");
      expect(out).toContain("[2|mine]");
      expect(out).toContain("[unset|mine]");
      // bash / zsh: LOCAL was a shell variable, never exported; PowerShell has only environment variables
      expect(out).toContain(kind === "pwsh" ? "child=mine" : "child=unset");
    });

    test("keeps the exit status", () => {
      env("A=1\n");
      const out = run([["cd", "proj"], ["false"], ["env"], ["status"]], "y\n");
      expect(out).toContain("s=1");
    });

    test("folder with a space and non-ASCII name", () => {
      const d = join(sb.root, "pro j", "Zoë");
      mkdirSync(d, { recursive: true });
      env("Z=1\n", d);
      const out = run([["cd", "pro j/Zoë"], ["env"], ["show", "Z"]], "y\n");
      expect(out).toContain("[1]");
      expect(readFileSync(join(sb.config, "env-trust"), "utf8")).toBe(`y\t${d}\n`);
    });
  });
}
