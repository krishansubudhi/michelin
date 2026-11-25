// A finished run's outcome for the terminal: the per-CUJ summary with its total, and the exit code.
//
// Test: node --test test/summary.test.ts

/**
 * The end-of-run summary over one or more runs: one line per CUJ, then the total. Pure.
 * A CUJ that ran more than once (--runs n) keeps every run: its line names each run's score and status, and it
 * passes only when every run did.
 *
 * @param runs Each run's run.json contents (defs, cujs, scores), in order.
 * @returns   e.g. "PASS  toy-country   passed 2/2  (done)\n...\ntotal: 1/2 CUJs passed"; with --runs 2 a line reads
 *            "FAIL  toy-country  1/2 runs passed: passed 2/2 (done), passed 1/2 (done)" and the total adds
 *            "(3/4 runs)". A run passes only when every expectation did ("passed n/n").
 */
export function summary(
  runs: { defs: object; cujs: Record<string, string>; scores: Record<string, string> }[],
): string {
  const seen = new Map<string, { score: string; status: string }[]>();
  for (const r of runs)
    for (const id of Object.keys(r.defs))
      seen.set(id, [...(seen.get(id) ?? []), { score: r.scores[id] ?? "unjudged", status: r.cujs[id] ?? "not run" }]);
  const ids = [...seen.keys()];
  const ok = (x: { score: string }) => /^passed (\d+)\/\1$/.test(x.score);
  const pass = (id: string) => seen.get(id)!.every(ok);
  const w = Math.max(0, ...ids.map((id) => id.length));
  const line = (id: string) => {
    const all = seen.get(id)!;
    const what =
      all.length === 1
        ? `${all[0].score}  (${all[0].status})`
        : `${all.filter(ok).length}/${all.length} runs passed: ${all.map((x) => `${x.score} (${x.status})`).join(", ")}`;
    return `${pass(id) ? "PASS" : "FAIL"}  ${id.padEnd(w)}  ${what}`;
  };
  const each = [...seen.values()].flat();
  const repeated = each.length > ids.length ? ` (${each.filter(ok).length}/${each.length} runs)` : "";
  return [...ids.map(line), `total: ${ids.filter(pass).length}/${ids.length} CUJs passed${repeated}`].join("\n");
}

/**
 * A run's own check result on a CUJ, from its score. Pure.
 *
 * @param score The run.json score, e.g. "passed 3/3"; undefined when the run has none.
 * @returns     "CHECK PASS (passed 3/3)" when every expectation passed, "CHECK FAIL (passed 2/4)" otherwise,
 *              "CHECK FAIL (unjudged)" when there is no score.
 */
export const checkLine = (score?: string) =>
  `CHECK ${/^passed (\d+)\/\1$/.test(score ?? "") ? "PASS" : "FAIL"} (${score ?? "unjudged"})`;

/**
 * The process exit code for a finished run. Pure.
 *
 * @param run The run.json contents.
 * @returns   1 if setup failed (nothing was tested), else 0. Failing CUJs are results, not errors.
 */
export const exitCode = (run: { setup: string }) => (run.setup === "ok" ? 0 : 1);

/**
 * Whether a CUJ's executor was called, so there is something to judge. Pure.
 *
 * @param status The CUJ's status in run.json, e.g. "done", "error: timed out", "unsupported: ...".
 * @returns      True for "done" and "error: ..."; false for a CUJ that was skipped or unsupported, or has no status.
 */
export const didRun = (status: string | undefined) => /^(done|error)/.test(status ?? "");
