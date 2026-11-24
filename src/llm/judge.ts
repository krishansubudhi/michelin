// Judge: alongside the destructor, judge LLMs score one CUJ's journey against its expectations.
// By default only the first judge in settings runs. The rest run, and the majority vote per expectation
// wins, only when that judge fails an expectation, gives no valid result, or differs from a baseline
// verdict (an earlier run's verdict.json, --baseline). With all (--all-judges) every judge runs at once.
//
// Writes into .runs/<runid>/<cujId>/:
//   judge-<model>-<effort>.json  each judge's checked result (schemas.ts JudgeResult) or its error
//   verdict.json                 per expectation: the votes, the majority, and each judge's reason
//
// The judges see the executor's typed result (executor.json), never the subject, so they can't go look:
// they run with no tools in a fresh temp folder. A garbled executor.json marks the CUJ errored, unjudged.
// Test: npm test (judge.test.ts, no LLM).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { toSession, type Llm, type Pick, type Session } from "./models.ts";
import { JUDGE, check, type Checked, type JudgeResult, type Vote } from "./schemas.ts";

/** How a run uses its judges: all runs every judge at once (--all-judges); baselines are earlier run folders. */
export type Judging = { all?: boolean; baselines?: string[] };

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
 * @returns            The full judge prompt.
 */
export function judgePrompt(expectations: string[], journey: string, reply: string): string {
  const list = expectations.map((e, i) => `${i + 1}. ${e.trim()}`).join("\n");
  return `You are a strict judge. Decide, from the evidence below only, whether each expectation holds.
Do not run tools or look anything up. If the evidence doesn't show it, it fails.

Expectations:
${list}

Journey (one JSON line per call made to the subject):
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
export type Evidence = { journey: string; reply: string; error?: undefined } | { error: string };

/**
 * Read the executor's evidence from executor.json. Missing or failed means empty evidence.
 *
 * @param out The CUJ's run folder, e.g. ".runs/<runid>/chat-name".
 * @returns   journey: steps as JSON lines; reply: the executor's reply, or why it failed;
 *            or {error} if executor.json isn't valid JSON, e.g. "executor.json is not valid JSON: ...".
 */
export function readEvidence(out: string): Evidence {
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
 * Whether the first judge's votes call for the other judges. Pure.
 *
 * @param votes    The first judge's verdicts in expectation order, or null if it gave no valid result.
 * @param baseline Each expectation's earlier verdict, e.g. [true, null] (null: none known); omitted if none.
 * @returns        true if votes is null, any vote fails, or any vote differs from a known baseline verdict.
 */
export function escalate(votes: Vote[] | null, baseline?: (boolean | null)[]): boolean {
  if (!votes) return true;
  return votes.some((v, i) => !v.pass || (typeof baseline?.[i] === "boolean" && baseline[i] !== v.pass));
}

/**
 * Read a CUJ's earlier verdicts from the first baseline run folder that judged it.
 *
 * @param dirs         Earlier run folders, e.g. [".runs/2026-01-01T00-00-00-000Z"]; each may hold <id>/verdict.json.
 * @param id           The CUJ id, e.g. "toy-country".
 * @param expectations The CUJ's expectations now; each is matched by its trimmed text, so an edited one has no baseline.
 * @returns            One earlier pass per expectation (null where none matched), e.g. [true, null];
 *                     undefined if no folder has a readable verdict.json for this CUJ.
 */
export function readBaseline(dirs: string[], id: string, expectations: string[]): (boolean | null)[] | undefined {
  for (const d of dirs) {
    const f = join(d, id, "verdict.json");
    if (!existsSync(f)) continue;
    let prior: Outcome[];
    try {
      prior = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(prior)) continue;
    const byText = new Map(prior.map((o) => [String(o.expectation).trim(), o.pass]));
    return expectations.map((e) => byText.get(e.trim()) ?? null);
  }
  return undefined;
}

/**
 * Call some judges in parallel on one prompt, write each one's checked result, and collect sessions and votes.
 *
 * @param llm    How to call an LLM.
 * @param judges The judges to call now, e.g. [{model: "claude-opus-5-5", effort: "high"}].
 * @param out    The CUJ's run folder; writes judge-<model>-<effort>.json per judge.
 * @param ask    prompt: the judge prompt (judgePrompt); n: how many expectations there are, e.g. 2.
 * @returns      sessions keyed "judge-<model>-<effort>"; votes keyed "<model>-<effort>", null for no valid result.
 */
async function callJudges(
  llm: Llm,
  judges: Pick[],
  out: string,
  { prompt, n }: { prompt: string; n: number },
): Promise<{ sessions: Record<string, Session>; votes: Record<string, Vote[] | null> }> {
  const opts = { timeoutS: 300, schema: JUDGE, tools: "", scratch: true };
  const results = await Promise.all(judges.map((j) => llm(j, prompt, opts)));
  const sessions: Record<string, Session> = {};
  const votes: Record<string, Vote[] | null> = {};
  judges.forEach((j, i) => {
    // Name each judge model-effort, so opus at high and opus at medium are separate voters.
    const m = `${j.model}-${j.effort}`;
    const r = results[i],
      c = checkJudge(r.data, r.error, n);
    sessions[`judge-${m}`] = toSession(j, r, c.ok ? null : c.error);
    votes[m] = c.ok ? c.data.verdicts : null;
    writeFileSync(
      join(out, `judge-${m}.json`),
      JSON.stringify({ ...c, sessionId: r.sessionId, ms: r.ms, raw: r.text }, null, 2),
    );
  });
  return { sessions, votes };
}

/**
 * Score one CUJ: the first judge, then the rest only if escalate() says so (or all at once with judging.all),
 * then the votes of every judge that ran are tallied.
 *
 * @param llm          How to call an LLM (the real llm() or a test fake).
 * @param panel        judge: the judges from settings.json, e.g. [{model: "claude-opus-5-5", effort: "high"}], the first
 *                     runs alone; judging: all, or baselines whose <id>/verdict.json (id = the out folder's name) is read.
 * @param out          The CUJ's run folder, e.g. ".runs/<runid>/chat-country".
 * @param cuj          The CUJ's expectations.
 * @returns            score: "passed k/n", or "unjudged" if any expectation got no valid vote;
 *                     sessions: one Session per judge that ran, keyed "judge-<model>-<effort>";
 *                     error: set (and no judge called) if executor.json couldn't be read.
 *                     Writes judge-<model>-<effort>.json per judge that ran and verdict.json.
 */
export async function judgeCuj(
  llm: Llm,
  { judge: judges, judging: { all = false, baselines = [] } = {} }: { judge: Pick[]; judging?: Judging },
  out: string,
  { expectations }: { expectations: string[] },
): Promise<{ score: string; sessions: Record<string, Session>; error?: string }> {
  const ev = readEvidence(out);
  if (ev.error !== undefined) return { score: "unjudged", sessions: {}, error: ev.error };
  const ask = { prompt: judgePrompt(expectations, ev.journey, ev.reply), n: expectations.length };
  const first = await callJudges(llm, all ? judges : judges.slice(0, 1), out, ask);
  const [firstVotes] = Object.values(first.votes);
  const baseline = readBaseline(baselines, basename(out), expectations);
  const rest =
    !all && judges.length > 1 && escalate(firstVotes, baseline)
      ? await callJudges(llm, judges.slice(1), out, ask)
      : { sessions: {}, votes: {} };
  const outcomes = tally(expectations, { ...first.votes, ...rest.votes });
  writeFileSync(join(out, "verdict.json"), JSON.stringify(outcomes, null, 2));
  const score = outcomes.some((o) => o.pass === null)
    ? "unjudged"
    : `passed ${outcomes.filter((o) => o.pass).length}/${outcomes.length}`;
  return { score, sessions: { ...first.sessions, ...rest.sessions } };
}
