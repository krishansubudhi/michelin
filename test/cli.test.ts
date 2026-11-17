// Tests for cli.ts, no LLM: node --test test/cli.test.ts  (or npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_CUJS, UsageError, parseCli } from "../src/run/cli.ts";

test("the command line: subject, CUJs, --settings, --all-judges, --baseline and --help", () => {
  assert.deepEqual(parseCli(["s", "a.yaml", "b.yaml"]), {
    subject: "s",
    picked: ["a.yaml", "b.yaml"],
    settingsPath: undefined,
    judging: { all: false, baselines: [] },
  });
  const j = parseCli(["--all-judges", "--baseline", "r1", "--baseline", "r2", "s", "a.yaml"]);
  assert.deepEqual(j?.judging, { all: true, baselines: ["r1", "r2"] });
  assert.equal(parseCli(["--settings", "x.json", "s", "a.yaml"])?.settingsPath, "x.json");
  assert.equal(parseCli(["--settings=x.json", "s", "a.yaml"])?.settingsPath, "x.json");
  assert.equal(parseCli(["--help"]), null);
  assert.equal(parseCli(["-h", "s"]), null);
  assert.throws(
    () => parseCli([]),
    (e: unknown) => e instanceof UsageError && /no subject/.test(e.message),
  );
  assert.throws(() => parseCli(["--bogus", "s"]), /Unknown option/);
});

test("no CUJs is a usage error, not a fallback to every CUJ", () => {
  for (const argv of [["s"], ["--settings", "x.json", "s"]])
    assert.throws(
      () => parseCli(argv),
      (e: unknown) => e instanceof UsageError && e.message === NO_CUJS,
    );
});
