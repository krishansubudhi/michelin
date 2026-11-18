// Tests for settings.ts, no LLM: node --test test/settings.test.ts
// Each bad case writes a temp settings file and checks loadSettings refuses it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, loadSettings, resolveSettings } from "../src/run/settings.ts";

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

test("the built-in defaults/settings.json names a model and effort for every role", () => {
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

const s5 = { model: "claude-sonnet-5-5", effort: "medium" };
const defaults = { constructor: h, executor: s5, destructor: h, judge: [o] } as Parameters<typeof resolveSettings>[0];
const resolved = (file: unknown, flags = {}) => resolveSettings(defaults, file, flags, "michelin.json");

test("no file and no flags: the defaults, no subject, no CUJs, one run", () => {
  assert.deepEqual(resolved({}), {
    settings: defaults,
    subject: undefined,
    cujs: [],
    runs: 1,
    pairJudges: 1,
    tiebreak: "speed",
  });
});

test("a partial file overrides only its fields; flags override the file", () => {
  const file = { executor: o, subject: "subjects/toy", cujs: ["subjects/toy/cujs/toy/"], runs: 2 };
  const c = resolved(file);
  const want = { settings: { ...defaults, executor: o }, subject: "subjects/toy", cujs: file.cujs, runs: 2 };
  assert.deepEqual(c, { ...want, pairJudges: 1, tiebreak: "speed" });
  const f = resolved(file, { model: "claude-sonnet-5-5", judges: "claude-opus-5-5,claude-sonnet-5-5@medium", runs: 5 });
  assert.deepEqual(f.settings.executor, { model: "claude-sonnet-5-5", effort: "high" }, "keeps the file's effort");
  assert.deepEqual(f.settings.judge, [o, s5], "effort high unless given");
  assert.equal(f.runs, 5);
  assert.deepEqual(resolved({}, { model: "x@low" }).settings.executor, { model: "x", effort: "low" });
});

test("a bad file field or flag is refused, naming the file and the field", () => {
  const bad: [unknown, RegExp][] = [
    [{ judges: [o] }, /michelin.json: unknown field "judges"/],
    [{ runs: 0 }, /michelin.json: field "runs"/],
    [{ runs: 1.5 }, /michelin.json: field "runs"/],
    [{ pair_judges: 0 }, /michelin.json: field "pair_judges"/],
    [{ pair_judges: "2" }, /michelin.json: field "pair_judges"/],
    [{ subject: 3 }, /michelin.json: field "subject"/],
    [{ cujs: "a.yaml" }, /michelin.json: field "cujs"/],
    [{ executor: "m" }, /michelin.json: field "executor"/],
    [{ judge: [] }, /michelin.json: field "judge"/],
    [[], /michelin.json: must be a JSON object/],
  ];
  for (const [file, re] of bad) assert.throws(() => resolved(file), re);
  assert.throws(() => resolved({}, { model: "m@huge" }), /--model/);
  assert.throws(() => resolved({}, { judges: "a,@high" }), /--judges/);
});

test("loadConfig reads ./michelin.json when present, or the --settings file instead; judging rides along", () => {
  const cwd = mkdtempSync(join(tmpdir(), "config-"));
  assert.equal(loadConfig({ flags: {}, cwd }).runs, 1, "no michelin.json: defaults alone");
  writeFileSync(join(cwd, "michelin.json"), JSON.stringify({ subject: "subjects/toy", runs: 2 }));
  writeFileSync(join(cwd, "other.json"), JSON.stringify({ runs: 3 }));
  const c = loadConfig({ flags: {}, cwd, judging: { all: true, baselines: [] } });
  assert.deepEqual([c.subject, c.runs, c.settings.judging], ["subjects/toy", 2, { all: true, baselines: [] }]);
  const o3 = loadConfig({ settingsPath: "other.json", flags: {}, cwd });
  assert.deepEqual([o3.subject, o3.runs], [undefined, 3], "--settings replaces michelin.json");
  assert.equal(loadConfig({ flags: { runs: 4 }, cwd }).runs, 4);
  assert.throws(() => loadConfig({ settingsPath: "nope.json", flags: {}, cwd }), /ENOENT/);
});

test("pair_judges: default 1, else michelin.json's whole number", () => {
  assert.equal(resolved({}).pairJudges, 1);
  assert.equal(resolved({ pair_judges: 3 }).pairJudges, 3);
  assert.equal(resolved({ tiebreak: "none" }).tiebreak, "none");
  assert.throws(() => resolved({ tiebreak: "fast" }), /tiebreak/);
  const cwd = mkdtempSync(join(tmpdir(), "config-"));
  assert.equal(loadConfig({ flags: {}, cwd }).pairJudges, 1, "no michelin.json");
  writeFileSync(join(cwd, "michelin.json"), JSON.stringify({ pair_judges: 2 }));
  assert.equal(loadConfig({ flags: {}, cwd }).pairJudges, 2);
});
