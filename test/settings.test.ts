// Tests for settings.ts, no LLM: node --test test/settings.test.ts
// Each bad case writes a temp settings file and checks loadSettings refuses it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../src/run/settings.ts";

const h = { model: "claude-haiku-5-5", effort: "low" };
const o = { model: "claude-opus-5-5", effort: "high" };
const good = { constructor: h, executor: h, destructor: h, judge: [o, h] };
const dir = mkdtempSync(join(tmpdir(), "settings-"));
// Write `body` to a temp file and return its path.
const file = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};
const refuses = (name: string, s: unknown, re = /needs constructor/) =>
  assert.throws(() => loadSettings(file(`${name}.json`, JSON.stringify(s))), re);

test("the real settings.json names a model and effort for every role", () => {
  loadSettings();
});

test("a good file loads as written", () => {
  assert.deepEqual(loadSettings(file("good.json", JSON.stringify(good))), good);
});

test("refuses a missing role", () => {
  for (const k of Object.keys(good)) {
    const rest = Object.fromEntries(Object.entries(good).filter(([key]) => key !== k));
    refuses(`missing-${k}`, rest);
  }
});

test("refuses an entry that isn't exactly {model, effort}", () => {
  refuses("bare-string", { ...good, executor: "claude-haiku-5-5" });
  refuses("no-effort", { ...good, executor: { model: "claude-haiku-5-5" } });
  refuses("bad-effort", { ...good, executor: { ...h, effort: "huge" } });
  refuses("extra-key", { ...good, executor: { ...h, temp: 0 } });
  refuses("list-constructor", { ...good, constructor: [h] });
});

test("refuses a judge that isn't a non-empty list of entries", () => {
  refuses("judge-one", { ...good, judge: o });
  refuses("judge-empty", { ...good, judge: [] });
  refuses("judge-string", { ...good, judge: [o, "claude-opus-5-5"] });
});

test("any model id loads: there is no allowlist, claude refuses a wrong one at its call", () => {
  const s = { ...good, judge: [{ model: "claude-fable-5-2", effort: "high" }] };
  assert.deepEqual(loadSettings(file("any-model.json", JSON.stringify(s))), s);
});

test("refuses an empty object and null", () => {
  refuses("empty", {});
  refuses("null", null);
});

test("bad JSON and a missing file throw", () => {
  assert.throws(() => loadSettings(file("bad.json", "{not json")), SyntaxError);
  assert.throws(() => loadSettings(join(dir, "nope.json")), /ENOENT/);
});

test("judging from the command line rides along on the settings; without it nothing is added", () => {
  const p = file("judging.json", JSON.stringify(good));
  assert.deepEqual(loadSettings(p, { all: true, baselines: ["r1"] }), {
    ...good,
    judging: { all: true, baselines: ["r1"] },
  });
  assert.ok(!("judging" in loadSettings(p)));
});
