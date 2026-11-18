// Tests for cli.ts, no LLM: node --test test/cli.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_CUJS, UsageError, helpText, parseCli, pickTargets } from "../src/run/cli.ts";

const usage = (re: RegExp | string) => (e: unknown) =>
  e instanceof UsageError && (typeof re === "string" ? e.message === re : re.test(e.message));

test("the command line: subject, CUJs, --settings, --all-judges, --baseline, and --help naming its command", () => {
  assert.deepEqual(parseCli(["s", "a.yaml", "b.yaml"]), {
    command: "run",
    subject: "s",
    picked: ["a.yaml", "b.yaml"],
    settingsPath: undefined,
    judging: { all: false, baselines: [] },
    flags: { executor: undefined, judges: undefined, runs: undefined },
  });
  const j = parseCli(["--all-judges", "--baseline", "r1", "--baseline", "r2", "s", "a.yaml"]);
  assert.deepEqual(j?.command === "run" && j.judging, { all: true, baselines: ["r1", "r2"] });
  assert.equal(parseCli(["--settings", "x.json", "s", "a.yaml"])?.settingsPath, "x.json");
  assert.equal(parseCli(["--settings=x.json", "s", "a.yaml"])?.settingsPath, "x.json");
  assert.deepEqual(parseCli(["--help"]), { command: "help", topic: undefined });
  assert.deepEqual(parseCli(["-h", "s"]), { command: "help", topic: undefined });
  assert.deepEqual(parseCli(["run", "-h"]), { command: "help", topic: "run" });
  assert.deepEqual(parseCli(["compare", "--help"]), { command: "help", topic: "compare" });
  assert.deepEqual(parseCli(["init", "--help"]), { command: "help", topic: "init" });
  assert.throws(() => parseCli(["--bogus", "s"]), /Unknown option/);
});

test("the word run is optional: michelin run s a.yaml is michelin s a.yaml", () => {
  assert.deepEqual(parseCli(["run", "s", "a.yaml"]), parseCli(["s", "a.yaml"]));
  assert.deepEqual(parseCli(["run"]), parseCli([]));
});

test("michelin init is its own command; flags and extra words are ignored", () => {
  assert.deepEqual(parseCli(["init"]), { command: "init" });
  assert.deepEqual(parseCli(["init", "x", "--runs", "2"]), { command: "init" });
});

test("subject and CUJs may be left out: michelin.json supplies them", () => {
  const a = parseCli([]);
  assert.deepEqual(a?.command === "run" && [a.subject, a.picked], [undefined, []]);
});

test("--executor (or its old name --model), --judges and --runs land in flags; --runs is a whole number >= 1", () => {
  const a = parseCli(["run", "--executor", "m@high", "--judges", "a,b@low", "--runs", "3"]);
  assert.deepEqual(a?.command === "run" && a.flags, { executor: "m@high", judges: "a,b@low", runs: 3 });
  const m = parseCli(["run", "--model", "m@high"]);
  assert.equal(m?.command === "run" && m.flags.executor, "m@high");
  for (const bad of ["0", "-1", "1.5", "two", ""])
    assert.throws(() => parseCli([`--runs=${bad}`, "s", "a.yaml"]), usage(/--runs must be a whole number/));
});

test("pickTargets: command-line positionals win, else michelin.json's subject and cujs", () => {
  const file = { subject: "f", cujs: ["f/cujs/"] };
  assert.deepEqual(pickTargets({ subject: "s", picked: ["a.yaml"] }, file), ["s", "a.yaml"]);
  assert.deepEqual(pickTargets({ subject: undefined, picked: [] }, file), ["f", "f/cujs/"]);
});

test("no subject or no CUJs is a usage error, not a fallback to every CUJ", () => {
  assert.throws(() => pickTargets({ picked: [] }, { cujs: [] }), usage(/no subject/));
  assert.throws(() => pickTargets({ picked: [] }, { cujs: ["a.yaml"] }), usage(/no subject/));
  assert.throws(() => pickTargets({ subject: "s", picked: [] }, { subject: "f", cujs: ["a.yaml"] }), usage(NO_CUJS));
  assert.throws(() => pickTargets({ picked: [] }, { subject: "f", cujs: [] }), usage(NO_CUJS));
});

test("michelin compare: two or more runs (dir or name=dir), --judges, --tiebreak, --settings and repeatable --hide", () => {
  assert.deepEqual(
    parseCli(["compare", "--judges", "a,b@low", "--hide", "box", "--hide", "me", "x=.runs/1", ".runs/2"]),
    {
      command: "compare",
      runs: ["x=.runs/1", ".runs/2"],
      settingsPath: undefined,
      flags: { judges: "a,b@low", tiebreak: undefined },
      hide: ["box", "me"],
    },
  );
  const c = parseCli(["compare", "--settings", "s.json", "a", "b", "c"]);
  assert.deepEqual(c?.command === "compare" && [c.runs, c.settingsPath, c.hide], [["a", "b", "c"], "s.json", []]);
  assert.throws(() => parseCli(["compare", "a"]), usage(/compare needs two or more run folders, got 1/));
  const n = parseCli(["compare", "--tiebreak", "none", "a", "b"]);
  assert.equal(n?.command === "compare" && n.flags.tiebreak, "none");
  assert.throws(() => parseCli(["compare", "--tiebreak", "x", "a", "b"]), usage(/--tiebreak must be speed or none/));
  assert.throws(() => parseCli(["compare"]), usage(/got 0/));
  assert.throws(() => parseCli(["--hide", "x", "s", "a.yaml"]), usage(/only for michelin compare/));
});

test("each command's help shows only its own flags and one example; the overview has the roles", () => {
  const run = helpText("run");
  assert.ok(run.includes("--executor") && run.includes("example:") && !run.includes("--model"));
  const compare = helpText("compare");
  assert.ok(compare.includes("--tiebreak") && compare.includes("example:"));
  assert.ok(!compare.includes("--runs") && !compare.includes("--executor"));
  const init = helpText("init");
  assert.ok(init.includes("example:") && !init.includes("--judges"));
  const all = helpText();
  for (const s of ["Roles:", "executor", "judges", "agent under test", "michelin run --help"])
    assert.ok(all.includes(s), s);
  for (const t of [run, compare, init, all]) for (const l of t.split("\n")) assert.ok(l.length <= 120, l);
});
