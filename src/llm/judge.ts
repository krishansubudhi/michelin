// Judge: alongside the destructor, each judge LLM scores one CUJ's journey against its
// expectations, and the majority vote per expectation wins.
//
// Writes into .runs/<runid>/<cujId>/:
//   judge-<model>-<effort>.json  each judge's checked result (schemas.ts JudgeResult) or its error
//   verdict.json                 per expectation: the votes, the majority, and each judge's reason
//
// The judges see the executor's typed result (executor.json), never the subject, so they can't go look:
// they run with no tools in a fresh temp folder. A garbled executor.json marks the CUJ errored, unjudged.
// Test: npm test (judge.test.ts, no LLM).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { toSession, type Llm, type Pick, type Session } from "./models.ts";
import { JUDGE, check, type Checked, type JudgeResult, type Vote } from "./schemas.ts";

/** The outcome for one expectation after every judge voted. */
export type Outcome = {
  /** The expectation text, e.g. "The reply says USA." */
  expectation: string;
  /** Each judge's vote, keyed by model-effort; null if that judge gave no valid result. */
  votes: Record<string, Vote | null>;
  /** Majority of the usable votes; null if no judge gave one. A tie fails. */
  pass: boolean | null;
};

/**
 * Build the prompt one judge sees. Pure.
 *
 * @param expectations What must be true, e.g. ["The reply says USA."].
 * @param journey      The executor's steps, one JSON object per line.
 * @param reply        The executor's final reply.
 * @param given        The CUJ's given state, seeded into the subject before the run; omitted if none.
 * @returns            The full judge prompt.
 */
export function judgePrompt(expectations: string[], journey: string, reply: string, given?: object): string {
  const list = expectations.map((e, i) => `${i + 1}. ${e.trim()}`).join("\n");
  const seeded = given
    ? `What was true before the run (seeded into the program, never told to it):\n${JSON.stringify(given, null, 2)}\nIt is not evidence: an expectation about using a fact passes only if the journey or reply shows the program used it.\n\n`
    : "";
  return `You are a strict judge. Decide, from the evidence below only, whether each expectation holds.
Do not run tools or look anything up. If the evidence doesn't show it, it fails.

Expectations:
${list}

${seeded}Journey (one JSON line per call made to the subject):
${journey.trim() || "(empty: nothing was logged)"}

Executor's final reply:
${reply.trim() || "(empty)"}

Return verdicts: exactly ${expectations.length}, in the order above, each {"pass": true or false, "why": "one sentence citing the journey"}.`;
}

/**
 * Check one judge's result: a valid JudgeResult with exactly n verdicts. Pure.
 *
 * @param data  The judge's structured output, e.g. {verdicts: [{pass: true, why: "..."}]}.
 * @param error The call's own error, or null.
 * @param n     How many expectations there are, e.g. 2.
 * @returns     {ok: true, data} or {ok: false, error}, e.g. "expected 2 verdicts, got 1".
 */
export function checkJudge(data: unknown, error: string | null, n: number): Checked<JudgeResult> {
  const c = check<JudgeResult>(JUDGE, data, error);
  if (c.ok && c.data.verdicts.length !== n)
    return { ok: false, error: `expected ${n} verdicts, got ${c.data.verdicts.length}` };
  return c;
}

/**
 * Combine every judge's votes into one outcome per expectation. Pure.
 *
 * @param expectations The expectation texts, in order.
 * @param byJudge      Each judge's votes keyed by model-effort, e.g. {"claude-opus-5-5-high": [...]}; null = no valid result.
 * @returns            One Outcome per expectation. pass = more than half of the usable votes passed.
 */
export function tally(expectations: string[], byJudge: Record<string, Vote[] | null>): Outcome[] {
  return expectations.map((expectation, i) => {
    const votes = Object.fromEntries(Object.entries(byJudge).map(([m, v]) => [m, v ? v[i] : null]));
    const usable = Object.values(votes).filter((v): v is Vote => v !== null);
    const yes = usable.filter((v) => v.pass).length;
    return { expectation, votes, pass: usable.length ? yes * 2 > usable.length : null };
  });
}

/** The executor's evidence for the judges, or why it couldn't be read. */
type Evidence = { journey: string; reply: string; error?: undefined } | { error: string };

/**
 * Read the executor's evidence from executor.json. Missing or failed means empty evidence.
 *
 * @param out The CUJ's run folder, e.g. ".runs/<runid>/chat-name".
 * @returns   journey: steps as JSON lines; reply: the executor's reply, or why it failed;
 *            or {error} if executor.json isn't valid JSON, e.g. "executor.json is not valid JSON: ...".
 */
function evidence(out: string): Evidence {
  const f = join(out, "executor.json");
  if (!existsSync(f)) return { journey: "", reply: "" };
  let e;
  try {
    e = JSON.parse(readFileSync(f, "utf8"));
  } catch (err) {
    return { error: `executor.json is not valid JSON: ${(err as Error).message}` };
  }
  if (!e?.ok) return { journey: "", reply: `(executor failed: ${e?.error})` };
  return { journey: e.data.steps.map((s: unknown) => JSON.stringify(s)).join("\n"), reply: e.data.reply };
}

/**
 * Score one CUJ: every judge runs in parallel, then the votes are tallied.
 *
 * @param llm          How to call an LLM (the real llm() or a test fake).
 * @param judges       Judges from settings.json, e.g. [{model: "claude-opus-5-5", effort: "high"}].
 * @param out          The CUJ's run folder, e.g. ".runs/<runid>/chat-country".
 * @param cuj          The CUJ's expectations, and its given (what was true before the run) if any.
 * @returns            score: "passed k/n", or "unjudged" if any expectation got no valid vote;
 *                     sessions: one Session per judge, keyed "judge-<model>-<effort>";
 *                     error: set (and no judge called) if executor.json couldn't be read.
 *                     Writes judge-<model>-<effort>.json per judge and verdict.json.
 */
export async function judgeCuj(
  llm: Llm,
  judges: Pick[],
  out: string,
  { expectations, given }: { expectations: string[]; given?: object },
): Promise<{ score: string; sessions: Record<string, Session>; error?: string }> {
  const ev = evidence(out);
  if (ev.error !== undefined) return { score: "unjudged", sessions: {}, error: ev.error };
  // Name each judge model-effort, so opus at high and opus at medium are separate voters.
  const names = judges.map((j) => `${j.model}-${j.effort}`);
  const prompt = judgePrompt(expectations, ev.journey, ev.reply, given);
  const opts = { timeoutS: 300, schema: JUDGE, tools: "", scratch: true };
  const results = await Promise.all(judges.map((j) => llm(j, prompt, opts)));
  const checked = results.map((r) => checkJudge(r.data, r.error, expectations.length));
  const sessions: Record<string, Session> = {};
  names.forEach((m, i) => {
    const r = results[i],
      c = checked[i];
    sessions[`judge-${m}`] = toSession(judges[i], r, c.ok ? null : c.error);
    writeFileSync(
      join(out, `judge-${m}.json`),
      JSON.stringify({ ...c, sessionId: r.sessionId, ms: r.ms, raw: r.text }, null, 2),
    );
  });
  const outcomes = tally(
    expectations,
    Object.fromEntries(
      names.map((m, i) => {
        const c = checked[i];
        return [m, c.ok ? c.data.verdicts : null];
      }),
    ),
  );
  writeFileSync(join(out, "verdict.json"), JSON.stringify(outcomes, null, 2));
  const score = outcomes.some((o) => o.pass === null)
    ? "unjudged"
    : `passed ${outcomes.filter((o) => o.pass).length}/${outcomes.length}`;
  return { score, sessions };
}
