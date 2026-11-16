// Integration tests: the real harness and the real runner, with real `claude -p` calls (costs money, minutes).
// Run: npm run test:integration. Not part of npm test, which needs neither the test/fixtures/ subjects nor an LLM.
//
// Each runner case spawns `node src/run/runner.ts <subject> [cuj]` and checks the run.json and report.html it leaves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Run the runner as a user does and read back what it wrote.
 *
 * @param args Runner arguments, e.g. ["test/fixtures/subjects/toy-v1", "test/fixtures/subjects/toy-v1/cujs/chat/name.yaml"].
 * @returns    code: exit status; dir: the run folder (from the first stdout line, "run dir: <dir> (tail -f ...)"); run: its run.json.
 */
function runRunner(args: string[]) {
  const p = spawnSync("node", ["src/run/runner.ts", ...args], { encoding: "utf8", timeout: 30 * 60 * 1000 });
  const dir = /^run dir: (\S+)/.exec(p.stdout.split("\n")[0])?.[1] ?? "";
  assert.ok(dir.startsWith(".runs"), `no run folder in stdout: ${p.stdout}\n${p.stderr}`);
  console.log(`# ${args.join(" ")} -> exit ${p.status}, ${join(dir, "report.html")}`);
  return { code: p.status, dir, run: JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) };
}

/** The parts of run.json these tests read. */
type RunJson = {
  sessions: Record<string, { sessionId: string | null }>;
  settings: { judge: { model: string; effort: string }[] };
};

/**
 * Assert every recorded session has a real claude session id and the report exists and offers to resume them.
 *
 * @param dir    The run folder.
 * @param run    Its run.json.
 * @param labels The session labels expected, e.g. ["constructor", "destructor"].
 */
function assertSessionsAndReport(dir: string, run: RunJson, labels: string[]) {
  for (const l of labels) assert.match(run.sessions[l]?.sessionId ?? "", /^[0-9a-f-]{36}$/, `session ${l} has an id`);
  const html = readFileSync(join(dir, "report.html"), "utf8");
  for (const l of labels)
    assert.ok(html.includes(`claude --resume ${run.sessions[l].sessionId}`), `report resumes ${l}`);
}

const TOY = "test/fixtures/subjects/toy-v1/cujs/chat";

const judgeLabels = (cuj: string, run: RunJson) => run.settings.judge.map((j) => `${cuj}/judge-${j.model}-${j.effort}`);

test("the toy answers one question", () => {
  const out = execFileSync("python3", ["test/fixtures/toy.py", "What is my name?"], { encoding: "utf8" });
  assert.match(out, /answer to question What is my name\? = /);
});

test("toy-v1 + chat/country: setup ok, the CUJ is judged a pass", () => {
  const { code, dir, run } = runRunner(["test/fixtures/subjects/toy-v1", `${TOY}/country.yaml`]);
  assert.equal(code, 0);
  assert.equal(run.setup, "ok");
  assert.equal(run.cujs["chat-country"], "done");
  assert.match(run.scores["chat-country"], /^passed (\d+)\/\1$/);
  assertSessionsAndReport(dir, run, [
    "constructor",
    "chat-country/executor",
    "destructor",
    ...judgeLabels("chat-country", run),
  ]);
});

test("toy-v1 + chat/name: setup ok, the CUJ is judged a fail (the toy answers USA)", () => {
  const { code, dir, run } = runRunner(["test/fixtures/subjects/toy-v1", `${TOY}/name.yaml`]);
  assert.equal(code, 0);
  assert.equal(run.setup, "ok");
  assert.equal(run.cujs["chat-name"], "done");
  assert.equal(run.scores["chat-name"], "passed 0/1");
  assertSessionsAndReport(dir, run, [
    "constructor",
    "chat-name/executor",
    "destructor",
    ...judgeLabels("chat-name", run),
  ]);
});

test("missing-v1: setup fails, every CUJ is skipped, teardown runs, exit non-zero", () => {
  const { code, dir, run } = runRunner([
    "test/fixtures/subjects/missing-v1",
    "test/fixtures/subjects/missing-v1/cujs/country.yaml",
  ]);
  assert.notEqual(code, 0);
  assert.equal(run.setup, "failed");
  assert.match(run.setupError, /not found/i);
  assert.ok(Object.keys(run.cujs).length > 0);
  for (const s of Object.values(run.cujs)) assert.equal(s, "skipped (setup failed)");
  assert.deepEqual(run.scores, {});
  assert.deepEqual(Object.keys(run.sessions).sort(), ["constructor", "destructor"]);
  assert.ok(existsSync(join(dir, "destructor.json")), "teardown ran");
  assertSessionsAndReport(dir, run, ["constructor", "destructor"]);
  assert.match(readFileSync(join(dir, "report.html"), "utf8"), /class="banner"[^>]*>Setup failed/);
});

test("given-v1 + codeword: setup seeds the given, so the toy knows the codeword; judged a pass", () => {
  const { code, run } = runRunner([
    "test/fixtures/subjects/given-v1",
    "test/fixtures/subjects/given-v1/cujs/codeword.yaml",
  ]);
  assert.equal(code, 0);
  assert.equal(run.setup, "ok");
  assert.match(run.scores["codeword"], /^passed (\d+)\/\1$/);
});
