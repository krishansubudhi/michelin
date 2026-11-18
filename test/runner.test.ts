// Tests for runner.ts, no LLM: node --test test/runner.test.ts  (or npm test)
// The run itself is tested with a fake LLM that records every call and replies from a script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executorPrompt,
  constructorPrompt,
  destructorPrompt,
  runSubject,
  SKIPPED,
  type Ctx,
} from "../src/run/runner.ts";
import { NO_CUJS } from "../src/run/cli.ts";
import { exitCode } from "../src/run/summary.ts";
import { loadCuj, type Cuj } from "../src/run/cujs.ts";
import type { Judging } from "../src/llm/judge.ts";

const SUBJECTS = ["subjects", "test/fixtures/subjects"];
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

test("every subject has setup, howtorun and teardown; other files are md, yaml, sh or py", () => {
  for (const d of SUBJECTS)
    for (const s of readdirSync(d)) {
      for (const f of ["setup.md", "howtorun.md", "teardown.md"])
        assert.ok(existsSync(`${d}/${s}/${f}`), `${d}/${s}/${f} missing`);
      const files = readdirSync(`${d}/${s}`, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
      assert.deepEqual(
        files.map((f) => f.name).filter((f) => !/\.(md|yaml|sh|py)$/.test(f)),
        [],
        `${d}/${s}: only .md, .yaml, .sh, .py`,
      );
    }
});

test("the executor prompt has the instruction, never expectations", () => {
  const cuj = loadCuj("test/fixtures/subjects/toy-v1/cujs/chat/name.yaml");
  const p = executorPrompt("HOWTO", cuj, "/repo");
  assert.ok(p.includes("HOWTO") && p.includes(cuj.instruction) && p.includes("/repo"));
  for (const e of cuj.expectations) assert.ok(!p.includes(e), `leaked expectation: ${e}`);
});

test("executor prompt includes setup output", () => {
  assert.ok(
    executorPrompt("HOWTO", { instruction: "do it" }, "/repo", { setup: "PORT=8792\nTOKEN=abc" }).includes("PORT=8792"),
  );
  assert.ok(!executorPrompt("HOWTO", { instruction: "do it" }, "/repo").includes("Setup output"));
});

test("executor prompt names the CUJ's run folder for screenshots, only when given", () => {
  assert.ok(
    executorPrompt("H", { instruction: "do" }, "/repo", { out: "/repo/.runs/r/c" }).includes("in /repo/.runs/r/c"),
  );
  assert.ok(!executorPrompt("H", { instruction: "do" }, "/repo").includes("for the record"));
});

test("the destructor prompt carries what setup reported, and omits the section when there is none", () => {
  assert.ok(destructorPrompt("TEARDOWN", '{"tmp":"/tmp/x"}').includes('What setup reported:\n{"tmp":"/tmp/x"}'));
  assert.ok(!destructorPrompt("TEARDOWN").includes("What setup reported"));
});

test("setup and teardown are told the run's scratch folder, and only when there is one", () => {
  assert.ok(constructorPrompt("SETUP", "/tmp/michelin/runs/x").includes("/tmp/michelin/runs/x"));
  assert.ok(destructorPrompt("TEARDOWN", "", "/tmp/michelin/runs/x").includes("/tmp/michelin/runs/x"));
  assert.ok(!constructorPrompt("SETUP").includes("Scratch"));
});

test("the given goes to setup, executor and judge prompts only when there is one", () => {
  const g = { memory: ["GIVEN-FACT"] };
  assert.match(constructorPrompt("SETUP", "", g), /GIVEN-FACT[\s\S]*Seed given[\s\S]*given <key>: seeded/);
  assert.match(
    executorPrompt("HOWTO", { instruction: "do it", given: g }, "/repo"),
    /you play the user[\s\S]*GIVEN-FACT/,
  );
  assert.ok(
    !constructorPrompt("SETUP").includes("Given") &&
      !executorPrompt("H", { instruction: "do" }, "/r").includes("seeded"),
  );
});

// --- the run, with a fake LLM ---

const pick = (model: string) => ({ model, effort: "low" as const });
const settings = { constructor: pick("C"), executor: pick("E"), destructor: pick("D"), judge: [pick("J")] };
const cuj = (instruction: string, timeout_s = 7): Cuj => ({
  instruction,
  timeout_s,
  expectations: [`SECRET-${instruction}`],
});
const two = [
  ["s/cujs/chat/one.yaml", cuj("one")],
  ["s/cujs/chat/two.yaml", cuj("two")],
] as const;

/**
 * A run context with a scripted fake LLM.
 *
 * @param reply Picks the fake structured output from (model, prompt); may throw to simulate a crash.
 *              Returning undefined means the call failed (error "exit 1").
 * @returns     ctx for runSubject, and calls: every [model, prompt, timeoutS] in order.
 */
function fake(reply: (model: string, prompt: string) => unknown) {
  const calls: [string, string, number | undefined][] = [];
  const files: Record<string, string> = {
    "setup.md": "SETUP-DOC",
    "howtorun.md": "HOWTO-DOC",
    "teardown.md": "TEARDOWN-DOC",
  };
  const ctx: Ctx = {
    settings,
    dir: tmp("run-"),
    read: (f) => files[f],
    llm: async ({ model: m }, p, o) => {
      calls.push([m, p, o?.timeoutS]);
      const data = reply(m, p);
      return {
        text: JSON.stringify(data ?? ""),
        data: data ?? null,
        sessionId: `sid-${m}-${calls.length}`,
        ms: 5,
        costUsd: 0.01,
        error: data === undefined ? "exit 1" : null,
      };
    },
  };
  return { ctx, calls };
}
const PASS = { verdicts: [{ pass: true, why: "seen" }] };
const SETUP_OK = { ok: true, steps: ["checked"], notes: "" };
const DID = { steps: [{ action: "run", input: "q", got: "a", ms: 3 }], reply: "did it" };
const CLEAN = { ok: true, cleaned: [], notes: "" };
const happy = (m: string) => (m === "C" ? SETUP_OK : m === "E" ? DID : m === "J" ? PASS : CLEAN);
const ok2 = { "chat-one": "passed 1/1", "chat-two": "passed 1/1" };
const read = (ctx: Ctx, f: string) => JSON.parse(readFileSync(join(ctx.dir, f), "utf8"));
const runJson = (ctx: Ctx) => read(ctx, "run.json");

test("a good run: construct once, each CUJ once in order, then destruct once alongside each judge", async () => {
  const { ctx, calls } = fake(happy);
  const run = await runSubject(ctx, "subj", [...two]);
  assert.deepEqual(run.cujs, { "chat-one": "done", "chat-two": "done" });
  assert.deepEqual(run.scores, ok2);
  assert.equal(exitCode(run), 0);
  assert.deepEqual(
    [
      ...calls.slice(0, 3).map((c) => c[0]),
      ...calls
        .slice(3)
        .map((c) => c[0])
        .sort(),
    ],
    ["C", "E", "E", "D", "J", "J"],
  );
  assert.match(
    calls.find((c) => c[0] === "J")![1],
    /SECRET-one[\s\S]*"got":"a"[\s\S]*did it/,
    "judge sees the expectation, the steps and the reply",
  );
  assert.match(calls[0][1], /SETUP-DOC[\s\S]*ok: false/);
  assert.match(calls[1][1], /HOWTO-DOC[\s\S]*one/);
  assert.match(calls.find((c) => c[0] === "D")![1], /TEARDOWN-DOC/);
  assert.equal(calls[1][2], 7, "executor gets the CUJ's timeout_s");
});

test("a good run writes run.json with every session, and each role's typed JSON", async () => {
  const { ctx } = fake(happy);
  await runSubject(ctx, "subj", [...two]);
  const run = runJson(ctx);
  assert.equal(run.setup, "ok");
  assert.deepEqual(Object.keys(run.sessions).sort(), [
    "chat-one/executor",
    "chat-one/judge-J-low",
    "chat-two/executor",
    "chat-two/judge-J-low",
    "constructor",
    "destructor",
  ]);
  assert.match(run.sessions.constructor.sessionId, /^sid-C-/);
  assert.equal(run.outputs["chat-one/judge-J-low"], join("chat-one", "judge-J-low.json"));
  assert.ok(run.finished, "finished time is set");
  assert.equal(read(ctx, "chat-one/verdict.json")[0].pass, true);
  assert.deepEqual(read(ctx, "chat-one/judge-J-low.json").data, PASS);
  assert.deepEqual(read(ctx, "constructor.json").data, SETUP_OK);
  assert.deepEqual(read(ctx, "destructor.json").data, CLEAN);
  assert.deepEqual(read(ctx, "chat-one/executor.json").data, DID);
  assert.ok(existsSync(join(ctx.dir, "report.html")), "report.html is written at the end");
});

test("a failed setup skips every CUJ: no executor, no judge, still destructs, exits non-zero", async () => {
  const notOk = { ok: false, steps: ["looked for harness"], notes: "harness not found: test/fixtures/nope.py" };
  for (const [setupReply, why] of [
    [notOk, /harness not found/],
    [undefined, /exit 1/],
    [{ ok: "yes" }, /invalid output/],
  ] as const) {
    const { ctx, calls } = fake((m) => (m === "C" ? setupReply : m === "D" ? CLEAN : PASS));
    const run = await runSubject(ctx, "subj", [...two]);
    assert.deepEqual(run.scores, {}, "nothing to judge");
    assert.deepEqual(run.cujs, { "chat-one": SKIPPED, "chat-two": SKIPPED });
    assert.deepEqual(
      calls.map((c) => c[0]),
      ["C", "D"],
      "no executor or judge call",
    );
    assert.equal(exitCode(run), 1);
    const saved = runJson(ctx);
    assert.equal(saved.setup, "failed");
    assert.match(saved.setupError, why);
    assert.deepEqual(Object.keys(saved.sessions), ["constructor", "destructor"]);
    assert.ok(!existsSync(join(ctx.dir, "chat-one")));
    assert.match(readFileSync(join(ctx.dir, "report.html"), "utf8"), /setup failed/i);
  }
});

test("an invalid executor result is an error, never a pass; the next CUJ still runs; both are judged", async () => {
  const { ctx } = fake((m, p) =>
    m === "C"
      ? SETUP_OK
      : m === "E"
        ? p.includes("Your task:\n\none")
          ? { steps: "nope", reply: 1 }
          : DID
        : m === "J"
          ? PASS
          : CLEAN,
  );
  const run = await runSubject(ctx, "subj", [...two]);
  assert.match(run.cujs["chat-one"], /^error: invalid output: \$\.steps: expected array/);
  assert.equal(run.cujs["chat-two"], "done");
  assert.deepEqual(Object.keys(run.scores), ["chat-one", "chat-two"]);
  assert.equal(read(ctx, "chat-one/executor.json").ok, false);
  assert.match(String(run.sessions["chat-one/executor"].error), /invalid output/);
});

test("a CUJ that throws still destructs and saves run.json", async () => {
  const { ctx, calls } = fake((m) => {
    if (m === "E") throw new Error("boom");
    return m === "C" ? SETUP_OK : CLEAN;
  });
  await assert.rejects(runSubject(ctx, "subj", [...two]), /boom/);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["C", "E", "D"],
  );
  assert.deepEqual(read(ctx, "destructor.json").data, CLEAN);
  assert.deepEqual(runJson(ctx).cujs, {});
  assert.ok(existsSync(join(ctx.dir, "report.html")));
});

test("a CUJ's given reaches constructor, executor and judges; a key setup did not report seeded fails setup", async () => {
  const withGiven = [["s/cujs/chat/one.yaml", { ...cuj("one"), given: { memory: ["GIVEN-FACT"] } }]] as const;
  const seeded = { ...SETUP_OK, notes: "given memory: seeded" };
  const { ctx, calls } = fake((m) => (m === "C" ? seeded : happy(m)));
  assert.equal((await runSubject(ctx, "subj", [...withGiven])).setup, "ok");
  for (const m of ["C", "E", "J"]) assert.match(calls.find((c) => c[0] === m)![1], /GIVEN-FACT/, `${m} sees the given`);
  const quiet = fake(happy);
  const run = await runSubject(quiet.ctx, "subj", [...withGiven]);
  assert.match(String(run.setupError), /given not seeded: memory/);
  assert.deepEqual(
    quiet.calls.map((c) => c[0]),
    ["C", "D"],
  );
});

test("CUJs with different givens in one shared run are refused before any LLM call", async () => {
  const { ctx, calls } = fake(happy);
  const mixed = [two[0], ["s/cujs/chat/two.yaml", { ...cuj("two"), given: { clock: "07:10" } }]] as const;
  await assert.rejects(
    runSubject(ctx, "subj", [...mixed]),
    /one\.yaml and s\/cujs\/chat\/two\.yaml have different given/,
  );
  assert.deepEqual(calls, []);
});

test("only the judge ever sees a CUJ's expectations", async () => {
  const { ctx, calls } = fake(happy);
  await runSubject(ctx, "subj", [...two]);
  for (const [, prompt] of calls.filter((c) => c[0] !== "J"))
    assert.ok(!prompt.includes("SECRET"), `leaked: ${prompt}`);
});

test("no CUJs: construct and destruct only", async () => {
  const { ctx, calls } = fake(happy);
  const run = await runSubject(ctx, "subj", []);
  assert.deepEqual([run.cujs, run.scores], [{}, {}]);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["C", "D"],
  );
});

test("no CUJs exits 2 with usage and the error on stderr, before setup and without a .runs entry", () => {
  const runs = () => (existsSync(".runs") ? readdirSync(".runs").sort() : []);
  const before = runs();
  assert.throws(
    () => execFileSync("node", ["src/run/runner.ts", `${SUBJECTS}/toy-v1`], { stdio: "pipe", timeout: 20_000 }),
    (e: unknown) => {
      const { status, stderr } = e as { status: number; stderr: unknown };
      return status === 2 && /usage: michelin/.test(String(stderr)) && String(stderr).includes(NO_CUJS);
    },
  );
  assert.deepEqual(runs(), before);
});

test("--help prints usage and exits 0; no subject exits 2", () => {
  assert.match(execFileSync("node", ["src/run/runner.ts", "--help"], { encoding: "utf8" }), /usage: michelin/);
  assert.throws(
    () => execFileSync("node", ["src/run/runner.ts"], { stdio: "pipe" }),
    (e: unknown) => (e as { status: number }).status === 2 && /usage/.test(String((e as { stderr: unknown }).stderr)),
  );
});

test("run.json records the claude version and each call's cost; executor and judges run in a scratch folder", async () => {
  const { ctx } = fake(happy);
  const scratch: string[] = [];
  const inner = ctx.llm;
  ctx.llm = (p, q, o) => (o?.scratch && scratch.push(p.model), inner(p, q, o));
  ctx.claudeVersion = "9.9.9 (Claude Code)";
  await runSubject(ctx, "subj", [two[0]]);
  const run = runJson(ctx);
  assert.equal(run.claudeVersion, "9.9.9 (Claude Code)");
  assert.equal(run.sessions.constructor.costUsd, 0.01);
  assert.deepEqual(scratch, ["E", "J"], "constructor and destructor run in the repo; executor and judge don't");
});

test("teardown and the judges of every CUJ run in parallel, each saved as it lands", async () => {
  const { ctx } = fake(happy);
  const spans: Record<string, [number, number]> = {};
  const inner = ctx.llm;
  ctx.llm = async (pick, p, o) => {
    const slow = pick.model === "D" || pick.model === "J";
    const key = pick.model === "J" ? (p.includes("SECRET-one") ? "J1" : "J2") : pick.model;
    const t0 = Date.now();
    if (slow) await new Promise((r) => setTimeout(r, 150));
    spans[key] = [t0, Date.now()];
    return inner(pick, p, o);
  };
  const run = await runSubject(ctx, "subj", [...two]);
  assert.deepEqual(run.scores, ok2);
  for (const [a, b] of [
    ["D", "J1"],
    ["D", "J2"],
    ["J1", "J2"],
  ])
    assert.ok(spans[a][0] < spans[b][1] && spans[b][0] < spans[a][1], `${a} and ${b} overlap`);
  assert.match(
    readFileSync(join(ctx.dir, "llm.log"), "utf8"),
    /role chat-one\/judges[\s\S]*role destructor|role destructor[\s\S]*role chat-one\/judges/,
  );
});

test("judging: the first judge alone by default; a baseline flip or judging.all brings in the rest", async () => {
  const twoJudges = { ...settings, judge: [pick("J"), pick("K")] };
  const judged = async (judging: Judging) => {
    const { ctx, calls } = fake((m) => (m === "J" || m === "K" ? PASS : happy(m)));
    await runSubject({ ...ctx, settings: { ...twoJudges, judging } }, "subj", [two[0]]);
    return calls
      .map((c) => c[0])
      .filter((m) => m === "J" || m === "K")
      .sort();
  };
  assert.deepEqual(await judged({}), ["J"]);
  assert.deepEqual(await judged({ all: true }), ["J", "K"]);
  const base = tmp("base-");
  mkdirSync(join(base, "chat-one"));
  const prior = [{ expectation: "SECRET-one", votes: {}, pass: false }];
  writeFileSync(join(base, "chat-one", "verdict.json"), JSON.stringify(prior));
  assert.deepEqual(await judged({ baselines: [base] }), ["J", "K"]);
});
