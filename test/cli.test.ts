// Tests for cli.ts, no LLM: node --test test/cli.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_CUJS, UsageError, parseCli, pickTargets } from "../src/run/cli.ts";

const usage = (re: RegExp | string) => (e: unknown) =>
  e instanceof UsageError && (typeof re === "string" ? e.message === re : re.test(e.message));

test("the command line: subject, CUJs, --settings, --all-judges, --baseline and --help", () => {
  assert.deepEqual(parseCli(["s", "a.yaml", "b.yaml"]), {
    command: "run",
    subject: "s",
    picked: ["a.yaml", "b.yaml"],
    settingsPath: undefined,
    judging: { all: false, baselines: [] },
    flags: { model: undefined, judges: undefined, runs: undefined },
  });
  const j = parseCli(["--all-judges", "--baseline", "r1", "--baseline", "r2", "s", "a.yaml"]);
  assert.deepEqual(j?.judging, { all: true, baselines: ["r1", "r2"] });
  assert.equal(parseCli(["--settings", "x.json", "s", "a.yaml"])?.settingsPath, "x.json");
  assert.equal(parseCli(["--settings=x.json", "s", "a.yaml"])?.settingsPath, "x.json");
  assert.equal(parseCli(["--help"]), null);
  assert.equal(parseCli(["-h", "s"]), null);
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
  assert.deepEqual([a?.subject, a?.picked], [undefined, []]);
});

test("--model, --judges and --runs land in flags; --runs must be a whole number >= 1", () => {
  const a = parseCli(["run", "--model", "m@high", "--judges", "a,b@low", "--runs", "3"]);
  assert.deepEqual(a?.flags, { model: "m@high", judges: "a,b@low", runs: 3 });
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

test("michelin compare: two or more runs (dir or name=dir), --judges, --settings and repeatable --hide", () => {
  assert.deepEqual(
    parseCli(["compare", "--judges", "a,b@low", "--hide", "box", "--hide", "me", "x=.runs/1", ".runs/2"]),
    {
      command: "compare",
      runs: ["x=.runs/1", ".runs/2"],
      settingsPath: undefined,
      flags: { judges: "a,b@low" },
      hide: ["box", "me"],
    },
  );
  const c = parseCli(["compare", "--settings", "s.json", "a", "b", "c"]);
  assert.deepEqual(c?.command === "compare" && [c.runs, c.settingsPath, c.hide], [["a", "b", "c"], "s.json", []]);
  assert.throws(() => parseCli(["compare", "a"]), usage(/compare needs two or more run folders, got 1/));
  assert.throws(() => parseCli(["compare"]), usage(/got 0/));
  assert.throws(() => parseCli(["--hide", "x", "s", "a.yaml"]), usage(/only for michelin compare/));
});
