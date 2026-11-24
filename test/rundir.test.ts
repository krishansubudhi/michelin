// Tests for rundir.ts: node --test test/rundir.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeUniqueDir } from "../src/run/rundir.ts";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("makeUniqueDir: runs started in the same millisecond, even in separate processes, each get their own folder", async () => {
  const base = join(tmp("michelin-ids-"), ".runs", "2026-11-24T00-00-00-000Z");
  const mine = Array.from({ length: 5 }, () => makeUniqueDir(base));
  assert.deepEqual(mine, [base, `${base}-2`, `${base}-3`, `${base}-4`, `${base}-5`]); // readable prefix kept
  const mod = JSON.stringify(pathToFileURL(resolve("src/run/rundir.ts")).href);
  const code = `import(${mod}).then((m) => console.log(m.makeUniqueDir(${JSON.stringify(base)})))`;
  const one = () =>
    new Promise<string>((ok, bad) =>
      execFile(process.execPath, ["-e", code], (e, out) => (e ? bad(e) : ok(out.trim()))),
    );
  const theirs = await Promise.all(Array.from({ length: 8 }, one)); // launched together, like `michelin a & michelin b`
  const all = [...mine, ...theirs];
  assert.equal(new Set(all).size, all.length, `duplicate folder in ${all.join(", ")}`);
  assert.equal(readdirSync(dirname(base)).length, all.length);
});
