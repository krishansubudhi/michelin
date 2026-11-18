// Tests for compare.ts: run arguments, round robin, standings and Elo, and compareMain end to end on fake run
// folders with a fake judge. Run: npm test (no LLM; everything is written under mkdtemp folders, never .runs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareMain,
  loadSide,
  parseRunArg,
  roundRobin,
  speedBreak,
  standings,
  measures,
  metricsTable,
  stepMs,
  timeTable,
  type Game,
} from "../src/run/compare.ts";
import type { LlmOpts, Pick } from "../src/llm/models.ts";

/** A fake LlmResult carrying `data` as the structured output. */
const res = (data: unknown) => ({ text: "raw", data, sessionId: "sid", ms: 1, costUsd: 0.01, error: null });

/**
 * Write a finished run folder: run.json, constructor.json and one CUJ with an executor reply and a verdict.
 *
 * @param root  Where to make it.
 * @param id    The run id (folder name).
 * @param model The executor model, also the constructor's MODEL= note.
 * @param reply The executor's reply on the shared CUJ.
 * @returns     The run folder.
 */
function fakeRun(root: string, id: string, model: string, reply: string): string {
  const dir = join(root, id);
  mkdirSync(join(dir, "math-add"), { recursive: true });
  const pick = { model, effort: "high" };
  const settings = { constructor: pick, executor: pick, destructor: pick, judge: [pick] };
  const defs = { "math-add": { path: "x.yaml", instruction: `Ask ${model} 6+7.`, timeout_s: 60 } };
  writeFileSync(join(dir, "run.json"), JSON.stringify({ subject: "subjects/opencode", settings, defs }));
  writeFileSync(join(dir, "constructor.json"), JSON.stringify({ ok: true, data: { notes: `MODEL=${model}` } }));
  const steps = [{ action: "run", input: `${model} 6+7`, got: reply, ms: 5 }];
  const executor = { ok: true, data: { steps, reply, metrics: [] } };
  writeFileSync(join(dir, "math-add", "executor.json"), JSON.stringify(executor));
  const verdict = [{ expectation: "The reply says 13.", votes: {}, pass: true }];
  writeFileSync(join(dir, "math-add", "verdict.json"), JSON.stringify(verdict));
  return dir;
}

/**
 * Give a fake run's CUJ a wall time and metrics by rewriting its executor.json.
 *
 * @param dir     The run folder from fakeRun.
 * @param ms      The executor call's wall ms, e.g. 9000.
 * @param metrics The recorded metrics, e.g. [{name: "tokens", value: "123"}]; malformed ones are allowed.
 */
function withMetrics(dir: string, ms: number, metrics: unknown[]): void {
  const f = join(dir, "math-add", "executor.json");
  const e = JSON.parse(readFileSync(f, "utf8"));
  writeFileSync(f, JSON.stringify({ ...e, ms, data: { ...e.data, metrics } }));
}

/** A fake judge: picks the program whose final reply says "13", else tie; records every prompt. */
function fakeJudge(prompts: string[]) {
  return async (_p: Pick, prompt: string, opts?: LlmOpts) => {
    prompts.push(prompt);
    assert.ok(opts?.logPath?.endsWith("llm.log"));
    const a = /Program A's final reply:\n([\s\S]*?)\n\nProgram B's journey/.exec(prompt)![1];
    const b = /Program B's final reply:\n([\s\S]*?)\n\nReturn/.exec(prompt)![1];
    const winner = a.includes("13") ? "A" : b.includes("13") ? "B" : "tie";
    return res({ winner, why: `${winner} said 13` });
  };
}

test("parseRunArg: dir or name=dir; a path with = in it later stays a dir", () => {
  assert.deepEqual(parseRunArg("g=.runs/x"), { name: "g", dir: ".runs/x" });
  assert.deepEqual(parseRunArg(".runs/x"), { dir: ".runs/x" });
  assert.deepEqual(parseRunArg("/a/b=c"), { dir: "/a/b=c" });
});

test("roundRobin: every pair once", () => {
  assert.deepEqual(roundRobin(3), [
    [0, 1],
    [0, 2],
    [1, 2],
  ]);
  assert.deepEqual(roundRobin(1), []);
});

const game = (a: string, b: string, winner: Game["winner"]): Game => ({ cuj: "c", a, b, winner, judges: {} });

test("standings: wins, losses, ties; a tie is 50%; Elo is symmetric around 1000; a null game counts for nothing", () => {
  const [x, y] = standings(["x", "y"], [game("x", "y", "a"), game("x", "y", null)]);
  assert.deepEqual([x.name, x.wins, x.losses, x.games, x.winRate], ["x", 1, 0, 1, 1]);
  assert.deepEqual([y.name, y.losses, y.winRate], ["y", 1, 0]);
  assert.equal(x.elo, 1016);
  assert.equal(x.elo + y.elo, 2000);
  const tie = standings(["p", "q"], [game("p", "q", "tie")]);
  assert.deepEqual(
    tie.map((r) => [r.ties, r.winRate, r.elo]),
    [
      [1, 0.5, 1000],
      [1, 0.5, 1000],
    ],
  );
  const three = standings(["a", "b", "c"], [game("a", "b", "b"), game("b", "c", "tie"), game("a", "c", "a")]);
  assert.deepEqual(
    three.map((r) => [r.name, `${r.wins}-${r.losses}-${r.ties}`, r.winRate]),
    [
      ["b", "1-0-1", 0.75],
      ["a", "1-1-0", 0.5],
      ["c", "0-1-1", 0.25],
    ],
  );
  assert.ok(Math.abs(three.reduce((s, r) => s + r.elo, 0) - 3000) < 1e-9);
});

test("loadSide: evidence, instruction, expectations and every identifier to hide", () => {
  const dir = fakeRun(mkdtempSync(join(tmpdir(), "cmp-")), "run-1", "ollama/gemma4:26b-mlx", "It said 13.");
  const s = loadSide(dir, "gem", ["box"]);
  assert.deepEqual(s.cujs["math-add"].task, {
    instruction: "Ask ollama/gemma4:26b-mlx 6+7.",
    expectations: ["The reply says 13."],
  });
  assert.equal(s.cujs["math-add"].evidence.reply, "It said 13.");
  for (const id of ["run-1", "subjects/opencode", "ollama/gemma4:26b-mlx", "box", "gem"]) assert.ok(s.ids.includes(id));
  assert.throws(() => loadSide(join(dir, "nope"), "x"), /run\.json: missing/);
});

test("compareMain: the run whose evidence says 13 tops compare.md at 100%; files land under cwd/.runs", async (t) => {
  t.mock.method(console, "log", () => {});
  const cwd = mkdtempSync(join(tmpdir(), "cmp-"));
  const good = fakeRun(cwd, "run-good", "ollama/gemma4:26b-mlx", "It said 13.");
  const bad = fakeRun(cwd, "run-bad", "ollama/qwen3.8:27b", "It said 12.");
  const prompts: string[] = [];
  const args = { runs: [bad, `winner=${good}`], flags: { judges: "J@high" }, hide: [] };
  const r = await compareMain(args, fakeJudge(prompts), cwd);
  assert.ok(r.out.startsWith(join(cwd, ".runs", "compare-")));
  assert.equal(prompts.length, 2, "one judge, both orders");
  assert.deepEqual(r.games[0].winner, "b");
  const md = readFileSync(join(r.out, "compare.md"), "utf8");
  assert.match(md.split("\n")[2], /^\| winner \| 1-0-0 \| 100% \| 1016 \|$/);
  assert.match(md.split("\n")[3], /^\| opencode \| 0-1-0 \| 0% \| 984 \|$/);
  assert.match(md, /Total judge cost: \$0\.0200/);
  assert.match(
    md,
    /## math-add: opencode vs winner[\s\S]*Winner: winner[\s\S]*opencode shown as A: winner\. B said 13/,
  );
  const json = JSON.parse(readFileSync(join(r.out, "compare.json"), "utf8"));
  assert.deepEqual([json.costUsd, json.rows[0].name, json.judges], [0.02, "winner", [{ model: "J", effort: "high" }]]);
  assert.match(readFileSync(join(r.out, "report.html"), "utf8"), /Head-to-head/);
  const game = join(r.out, "math-add", "opencode-vs-winner");
  for (const f of ["prompt-AB.txt", "prompt-BA.txt", "pair-J-high-AB.json", "pair-J-high-BA.json"])
    assert.ok(existsSync(join(game, f)), f);
  for (const p of prompts) assert.doesNotMatch(p, /gemma|qwen|run-good|run-bad|opencode/i, "blind");
});

test("compareMain: unnamed runs of one subject get #n; the panel is the first pair_judges judges", async (t) => {
  t.mock.method(console, "log", () => {});
  const cwd = mkdtempSync(join(tmpdir(), "cmp-"));
  const runs = ["13.", "12.", "11."].map((reply, i) => fakeRun(cwd, `r${i}`, `ollama/m${i}`, `It said ${reply}`));
  const pick = (model: string) => ({ model, effort: "high" });
  writeFileSync(
    join(cwd, "michelin.json"),
    JSON.stringify({ judge: [pick("J1"), pick("J2"), pick("J3")], pair_judges: 2 }),
  );
  const prompts: string[] = [];
  const r = await compareMain({ runs, flags: {}, hide: [] }, fakeJudge(prompts), cwd);
  assert.equal(prompts.length, 3 * 2 * 2, "3 games x 2 judges x 2 orders");
  assert.deepEqual(
    r.rows.map((x) => [x.name, x.wins, x.losses, x.ties]),
    [
      ["opencode#1", 2, 0, 0],
      ["opencode#3", 0, 1, 1],
      ["opencode#2", 0, 1, 1],
    ],
    "equal win rates: #3 lost to a stronger #1, so its Elo is higher",
  );
  assert.deepEqual(Object.keys(r.games[0].judges), ["J1-high", "J2-high"]);
  await assert.rejects(
    compareMain({ runs: [`a=${runs[0]}`, `a=${runs[1]}`], flags: {}, hide: [] }, fakeJudge([]), cwd),
    /both named "a"/,
  );
});

test("speedBreak: a judged tie goes to the run 1.5x faster; close times, none or a real win stay", () => {
  assert.deepEqual(speedBreak("tie", { a: 1000, b: 1600 }, "speed"), { winner: "a", bySpeed: true });
  assert.deepEqual(speedBreak("tie", { a: 3000, b: 2000 }, "speed"), { winner: "b", bySpeed: true });
  assert.deepEqual(speedBreak("tie", { a: 1000, b: 1400 }, "speed"), { winner: "tie", bySpeed: false });
  assert.deepEqual(speedBreak("tie", { a: 1000, b: 9000 }, "none"), { winner: "tie", bySpeed: false });
  assert.deepEqual(speedBreak("tie", { a: 1000 }, "speed"), { winner: "tie", bySpeed: false });
  assert.deepEqual(speedBreak("b", { a: 1000, b: 9000 }, "speed"), { winner: "b", bySpeed: false });
});

test("stepMs sums the executor steps' ms; timeTable shows seconds and marks a speed win", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "michelin-ms-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(
    join(dir, "executor.json"),
    JSON.stringify({ ok: true, data: { steps: [{ ms: 1200 }, { ms: 300 }, {}] } }),
  );
  assert.equal(stepMs(dir), 1500);
  assert.equal(stepMs(join(dir, "none")), undefined);
  const g: Game = { cuj: "c", a: "x", b: "y", winner: "a", judges: {}, ms: { a: 1500 }, bySpeed: true };
  assert.match(timeTable([g]), /\| c \| x \| y \| 1\.5 s \| \? \| x \(speed\) \|/);
});

test("metrics: a recorded metric becomes a column; wall time is executor.json's top-level ms; judges never see it", async (t) => {
  t.mock.method(console, "log", () => {});
  const cwd = mkdtempSync(join(tmpdir(), "cmp-"));
  const metrics = [{ name: "tokens", value: "123" }, { name: "bad" }, { name: "cost", value: "a|b" }];
  const good = fakeRun(cwd, "run-good", "ollama/gemma4:26b-mlx", "It said 13.");
  const bad = fakeRun(cwd, "run-bad", "ollama/qwen3.8:27b", "It said 12.");
  withMetrics(good, 9000, metrics);
  const sides = [loadSide(good, "g"), loadSide(bad, "b")];
  assert.deepEqual([sides[0].cujs["math-add"].wall, sides[1].cujs["math-add"].wall], [9000, undefined]);
  const tbl = metricsTable(measures(sides)).split("\n");
  assert.equal(tbl[0], "| CUJ | run | program time | wall time | tokens | cost |");
  assert.equal(tbl[2], "| math-add | g | 0.0 s | 9.0 s | 123 | a\\|b |");
  assert.equal(tbl[3], "| math-add | b | 0.0 s | ? | ? | ? |");
  const prompts: string[] = [];
  const r = await compareMain(
    { runs: [`g=${good}`, `b=${bad}`], flags: { judges: "J@high" }, hide: [] },
    fakeJudge(prompts),
    cwd,
  );
  const md = readFileSync(join(r.out, "compare.md"), "utf8");
  assert.match(
    md,
    /\| CUJ \| run \| program time \| wall time \| tokens \| cost \|\n[\s\S]*\| math-add \| g \| 0\.0 s \| 9\.0 s \| 123 \|/,
  );
  assert.ok(md.indexOf("wall time") < md.indexOf("Total judge cost"));
  const json = JSON.parse(readFileSync(join(r.out, "compare.json"), "utf8"));
  assert.deepEqual(json.measures[0].metrics, { tokens: "123", cost: "a|b" });
  assert.match(
    readFileSync(join(r.out, "report.html"), "utf8"),
    /Times and metrics[\s\S]*<th scope="col">tokens<\/th>/,
  );
  for (const p of prompts) assert.doesNotMatch(p, /tokens|123/, "metrics never reach a judge");
});

test("metricsTable: runs with no metrics get exactly the time columns", () => {
  const sides = [fakeRun(mkdtempSync(join(tmpdir(), "cmp-")), "r", "m", "x")].map((d) => loadSide(d, "r"));
  assert.equal(metricsTable(measures(sides)).split("\n")[0], "| CUJ | run | program time | wall time |");
});
