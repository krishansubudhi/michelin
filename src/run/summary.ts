// A finished run's outcome for the terminal: the per-CUJ summary with its total, and the exit code.
//
// Test: node --test test/summary.test.ts

/**
 * The end-of-run summary over one or more runs: one line per CUJ, then the total. Pure.
 *
 * @param runs Each run's run.json contents (defs, cujs, scores), in order.
 * @returns   e.g. "PASS  toy-country   passed 2/2  (done)\n...\ntotal: 1/2 CUJs passed"; a CUJ passes
 *            only when every expectation did ("passed n/n").
 */
export function summary(
  runs: { defs: object; cujs: Record<string, string>; scores: Record<string, string> }[],
): string {
  const run = {
    defs: Object.assign({}, ...runs.map((r) => r.defs)),
    cujs: Object.assign({}, ...runs.map((r) => r.cujs)),
    scores: Object.assign({}, ...runs.map((r) => r.scores)),
  };
  const ids = Object.keys(run.defs);
  const pass = (id: string) => /^passed (\d+)\/\1$/.test(run.scores[id] ?? "");
  const w = Math.max(0, ...ids.map((id) => id.length));
  const line = (id: string) =>
    `${pass(id) ? "PASS" : "FAIL"}  ${id.padEnd(w)}  ${run.scores[id] ?? "unjudged"}  (${run.cujs[id] ?? "not run"})`;
  return [...ids.map(line), `total: ${ids.filter(pass).length}/${ids.length} CUJs passed`].join("\n");
}

/**
 * The process exit code for a finished run. Pure.
 *
 * @param run The run.json contents.
 * @returns   1 if setup failed (nothing was tested), else 0. Failing CUJs are results, not errors.
 */
export const exitCode = (run: { setup: string }) => (run.setup === "ok" ? 0 : 1);
