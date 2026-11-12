// The bash script's side of the protocol (src/protocol.ts).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { sandbox, Sandbox } from "./run";
import { shellCases } from "./cases";

shellCases("bash");

describe("bash only", () => {
  let sb: Sandbox;
  beforeEach(() => (sb = sandbox()));
  afterEach(() => sb.done());
  test("needs bash 4", () => {
    const r = sb.run("bash", "echo ${BASH_VERSINFO[0]}");
    expect(Number(r.stdout.trim())).toBeGreaterThanOrEqual(4);
  });
});
