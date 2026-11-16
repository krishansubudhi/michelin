// Timeline: the report's phases (Setup, each CUJ, Teardown, Judges) as a vertical timeline. Every function here is pure.
//
// Test: npm test (render.test.ts).

import type { Session } from "../llm/models.ts";
import type { Checked, Setup, Teardown } from "../llm/schemas.ts";
import type { CujView, Loose, RunView } from "./view.ts";
import { alive, esc, fmtMs, pill, sessionsHtml } from "./html.ts";
import { cujBody, cujPill } from "./cuj.ts";

/** A timeline node's status; "running" is the current phase of a live run. */
type PhaseStatus = "ok" | "failed" | "errored" | "skipped" | "pending" | "running";

/** One node on the timeline: setup, a CUJ, teardown or the judges. */
type Phase = {
  /** Stable key, e.g. "setup" or "cuj:chat-name". */
  key: string;
  /** Title HTML (already escaped), e.g. "Setup". */
  title: string;
  status: PhaseStatus;
  /** Measured duration in ms, or null if unknown. */
  ms: number | null;
  /** Pill HTML after the title; "" means the status pill. */
  pills: string;
  /** Expanded HTML (already escaped); "" means nothing to expand. */
  body: string;
};

const COLOR: Record<PhaseStatus, "ok" | "bad" | "na" | "run"> = {
  ok: "ok",
  failed: "bad",
  errored: "bad",
  skipped: "na",
  pending: "na",
  running: "run",
};

/** An own entry of a record, so "constructor" never finds Object.prototype.constructor. Pure. */
const own = <T>(r: Record<string, T>, k: string): T | undefined => (Object.hasOwn(r, k) ? r[k] : undefined);

/** A session's ms, or null if missing. Pure. */
const sessMs = (s: Session | undefined) => (s && Number.isFinite(Number(s.ms)) ? Number(s.ms) : null);

/** Setup or teardown, as rolePhase needs it. */
type Role = {
  /** "setup" or "teardown". */
  key: string;
  /** constructor.json or destructor.json, or null. */
  c: Checked<Setup | Teardown> | null;
  /** The field listing what it did: "steps" or "cleaned". */
  items: "steps" | "cleaned";
  /** run.setup for setup ("" | "ok" | "failed"), "" for teardown. */
  flag: string;
};

/** A role's status: errored if its call failed, else what it reported; from the flag if there is no output. Pure. */
function roleStatus({ c, flag }: Role): PhaseStatus {
  if (c) return !c.ok ? "errored" : c.data.ok ? "ok" : "failed";
  return flag === "ok" || flag === "failed" ? flag : "pending";
}

/** What a role did and its notes, or its error. Pure. */
function roleBody({ c, items }: Role): string {
  if (!c) return "";
  if (!c.ok) return `<p class="err">${esc(c.error)}</p>`;
  const did = (c.data as Partial<Setup & Teardown>)[items] ?? [];
  return (
    `<ul>${did.map((x: string) => `<li>${esc(x)}</li>`).join("")}</ul>` +
    (c.data.notes ? `<p class="notes">${esc(c.data.notes)}</p>` : "")
  );
}

/**
 * Setup or teardown as a phase. Pure.
 *
 * @param r       The role.
 * @param session Its session ("constructor" or "destructor"), or undefined.
 * @returns       The phase.
 */
function rolePhase(r: Role, session: Session | undefined): Phase {
  const label = r.key === "setup" ? "constructor" : "destructor";
  return {
    key: r.key,
    title: r.key === "setup" ? "Setup" : "Teardown",
    status: roleStatus(r),
    ms: sessMs(session),
    pills: "",
    body: roleBody(r) + (session ? sessionsHtml([[label, session]]) : ""),
  };
}

/**
 * A CUJ's status from run.json and its outputs. Pure.
 *
 * @param c The CUJ view.
 * @returns e.g. "ok" when every expectation passed, "pending" before it ran.
 */
function cujStatus(c: CujView): PhaseStatus {
  if (!c.status) return "pending";
  if (c.status.startsWith("skipped")) return "skipped";
  if (c.status.startsWith("error") || (c.executor && !c.executor.ok)) return "errored";
  return c.outcomes.some((o) => o.pass === false) ? "failed" : "ok";
}

/**
 * One CUJ as a phase: status, score pill and everything known about it. Pure.
 *
 * @param c The CUJ view.
 * @returns The phase.
 */
function cujPhase(c: CujView): Phase {
  const status = cujStatus(c);
  const ex = c.sessions.find(([k]) => k === "executor")?.[1];
  const score = c.outcomes.length || c.score ? ` ${cujPill(c, "passed ")}` : "";
  const pills = status === "skipped" ? cujPill(c, "") : pill(status, COLOR[status]) + score;
  return {
    key: `cuj:${c.id}`,
    title: `CUJ <span class="cid">${esc(c.id)}</span>`,
    status,
    ms: sessMs(ex),
    pills,
    body: cujBody(c),
  };
}

/** True once a CUJ has a score or verdict. Pure. */
const judgedCuj = (c: CujView) => Boolean(c.score || c.outcomes.length);

/** True if a CUJ was skipped. Pure. */
const skippedCuj = (c: CujView) => c.status.startsWith("skipped");

/**
 * The judging phase's status. Pure.
 *
 * @param cujs The CUJ views.
 * @returns    pending until every CUJ that ran is judged; skipped if none ran because all were skipped.
 */
function judgesStatus(cujs: CujView[]): PhaseStatus {
  const ran = cujs.filter((c) => c.status && !skippedCuj(c));
  if (cujs.length && cujs.every(skippedCuj)) return "skipped";
  if (!ran.length || !ran.every(judgedCuj)) return "pending";
  if (ran.some((c) => c.status.startsWith("error"))) return "errored";
  return ran.some((c) => c.outcomes.some((o) => o.pass === false)) ? "failed" : "ok";
}

/**
 * The judging phase, run after teardown for every CUJ that ran. Pure.
 *
 * @param cujs  The CUJ views.
 * @param judge settings.judge, e.g. [{model, effort}].
 * @returns     The phase; its time is the slowest judge per CUJ (judges run in parallel), summed.
 */
function judgesPhase(cujs: CujView[], judge: Loose): Phase {
  const status = judgesStatus(cujs);
  const ran = cujs.filter((c) => c.status && !skippedCuj(c)),
    judged = ran.filter(judgedCuj);
  const all = judged.flatMap((c) => c.outcomes),
    passed = all.filter((o) => o.pass === true).length;
  const slowest = (c: CujView) =>
    Math.max(0, ...c.sessions.filter(([k]) => k.startsWith("judge")).map(([, s]) => sessMs(s) ?? 0));
  const who = (Array.isArray(judge) ? judge : []).map((j: Loose) => `${esc(j?.model)} · ${esc(j?.effort)}`);
  const li = ran.map(
    (c) =>
      `<li><a href="#cuj-${esc(c.id)}" class="cid">${esc(c.id)}</a> ${judgedCuj(c) ? cujPill(c, "passed ") : pill("waiting", "na")}</li>`,
  );
  const score = all.length ? ` ${pill(`${passed}/${all.length}`, passed === all.length ? "ok" : "bad")}` : "";
  return {
    key: "judges",
    title: "Judges",
    status,
    ms: judged.length ? judged.reduce((a, c) => a + slowest(c), 0) : null,
    pills: status === "pending" || status === "skipped" ? "" : pill(status, COLOR[status]) + score,
    body: (who.length ? `<p class="muted">${who.join(", ")}</p>` : "") + (li.length ? `<ul>${li.join("")}</ul>` : ""),
  };
}

/**
 * The CUJs in run order: run.json defs order first, then any others by id. Pure.
 *
 * @param view The run view.
 * @returns    The CUJ views.
 */
function runOrder(view: RunView): CujView[] {
  const order = Object.keys(view.run.defs ?? {});
  const at = (c: CujView) => (order.includes(c.id) ? order.indexOf(c.id) : order.length);
  return [...view.cujs].sort((a, b) => at(a) - at(b) || a.id.localeCompare(b.id));
}

/**
 * Every phase in order: Setup, each CUJ, Teardown, Judges. The first unfinished phase of a live run is "running";
 * unfinished phases of a finished run were never reached and count as skipped. Pure.
 *
 * @param view The run view.
 * @param now  Render time in ms.
 * @returns    The phases.
 */
function phases(view: RunView, now: number): Phase[] {
  const run = view.run;
  const list = [
    rolePhase(
      { key: "setup", c: view.constructor, items: "steps", flag: String(run.setup ?? "") },
      own(view.sessions, "constructor"),
    ),
    ...runOrder(view).map(cujPhase),
    rolePhase({ key: "teardown", c: view.destructor, items: "cleaned", flag: "" }, own(view.sessions, "destructor")),
    judgesPhase(view.cujs, run.settings?.judge),
  ];
  const pending = list.filter((p) => p.status === "pending");
  if (run.finished) for (const p of pending) p.status = "skipped";
  else if (pending.length && alive(run, now)) pending[0].status = "running";
  return list;
}

/** Format an ISO-ms time as "HH:MM:SS UTC". Pure. */
const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 19)} UTC`;

/**
 * A node's "start · duration" line. Pure.
 *
 * @param p     The phase.
 * @param start Its start in ms, NaN if unknown.
 * @param now   Render time in ms.
 * @returns     e.g. "02:14:11 UTC · 10.3 s", or "waiting" for a pending phase.
 */
function metaText(p: Phase, start: number, now: number): string {
  const known = Number.isFinite(start);
  let dur = p.ms !== null ? fmtMs(p.ms) : "";
  if (p.status === "running") dur = known ? `${fmtMs(Math.max(0, now - start))} so far` : "running";
  const text = [known ? clock(start) : "", dur].filter(Boolean).join(" · ");
  return text || (p.status === "pending" ? "waiting" : "—");
}

/**
 * One timeline node: dot, title, pills, meta line, and its body folded (open when it failed). Pure.
 *
 * @param p    The phase.
 * @param meta Its meta line.
 * @returns    HTML <li>.
 */
function nodeHtml(p: Phase, meta: string): string {
  const cls = `dot${p.status === "running" ? " pulse" : ""}${p.status === "pending" ? " hollow" : ""}`;
  const dot = `<span class="${cls}" aria-hidden="true"></span>`;
  const head =
    `<span class="nt">${p.title}</span> ${p.pills || pill(p.status, COLOR[p.status])}` +
    `<div class="meta">${esc(meta)}</div>`;
  const open = p.status === "failed" || p.status === "errored" ? " open" : "";
  const inner = p.body
    ? `<details${open}><summary>${head}</summary><div class="nb">${p.body}</div></details>`
    : `<div class="head">${head}</div>`;
  const id = p.key.startsWith("cuj:") ? ` id="cuj-${esc(p.key.slice(4))}"` : "";
  return `<li class="node ${p.status}" data-phase="${esc(p.key)}"${id}>${dot}${inner}</li>`;
}

/**
 * The vertical timeline: one node per phase with a dot, title, start time, duration and status. Pure.
 * Start times are run.started plus the durations before; the running dot pulses and pending dots are hollow.
 *
 * @param view The run view.
 * @param now  Render time in ms.
 * @returns    HTML.
 */
export function timelineHtml(view: RunView, now: number): string {
  let t = Date.parse(view.run.started ?? "");
  const li = phases(view, now).map((p) => {
    const start = p.status === "pending" || p.status === "skipped" ? NaN : t;
    if (p.ms !== null) t += p.ms;
    return nodeHtml(p, metaText(p, start, now));
  });
  return `<ol class="timeline">${li.join("")}</ol>`;
}
