// Tests for init.ts, no LLM: node --test test/init.test.ts  (or npm test)
// Each case runs init in a fresh temp folder against this checkout as the package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PKG_ROOT, init } from "../src/run/init.ts";
import { loadConfig, loadSettings } from "../src/run/settings.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "init-"));

test("init writes michelin.json and copies the toy subject, printing absolute paths; the file resolves to the toy subject", () => {
  const cwd = tmp();
  assert.deepEqual(init(cwd, PKG_ROOT), [
    `wrote ${join(cwd, "michelin.json")}`,
    `copied the toy subject to ${join(cwd, "subjects", "toy")}`,
    "next: michelin run",
  ]);
  for (const f of ["setup.md", "howtorun.md", "teardown.md", "toy.py", "cujs/toy/country.yaml"])
    assert.ok(existsSync(join(cwd, "subjects/toy", f)), `subjects/toy/${f} missing`);
  const c = loadConfig({ flags: {}, cwd });
  assert.deepEqual([c.subject, c.cujs, c.runs], ["subjects/toy", ["subjects/toy/cujs/toy/"], 1]);
  const d = loadSettings();
  assert.deepEqual([c.settings.executor, c.settings.judge], [d.executor, d.judge]);
});

test("the starter michelin.json holds only what differs from the defaults: subject and cujs", () => {
  const cwd = tmp();
  init(cwd, PKG_ROOT);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, "michelin.json"), "utf8")), {
    subject: "subjects/toy",
    cujs: ["subjects/toy/cujs/toy/"],
  });
});

test("a second init overwrites nothing and says so, naming the absolute paths kept", () => {
  const cwd = tmp();
  init(cwd, PKG_ROOT);
  writeFileSync(join(cwd, "michelin.json"), '{"runs": 2}');
  writeFileSync(join(cwd, "subjects/toy/setup.md"), "mine");
  assert.deepEqual(init(cwd, PKG_ROOT).slice(0, 2), [
    `kept existing ${join(cwd, "michelin.json")}`,
    `kept existing ${join(cwd, "subjects", "toy")}`,
  ]);
  assert.equal(readFileSync(join(cwd, "michelin.json"), "utf8"), '{"runs": 2}');
  assert.equal(readFileSync(join(cwd, "subjects/toy/setup.md"), "utf8"), "mine");
});
