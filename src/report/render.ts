// Render: turns a typed RunView (report.ts) into one self-contained HTML page. Every function here is pure.
// Styling is Tailwind (src/report/report.css), precompiled by `npm run css` into src/report/tailwind.gen.ts and inlined here.
//
// Test: npm test (render.test.ts and report.test.ts, no LLM).

import { alive, esc, fmtMs, fmtUsd, sessionsHtml, STALE_MS } from "./html.ts";
import type { FileText, Loose, RunView } from "./view.ts";
import { TAILWIND_CSS } from "./tailwind.gen.ts";
import { timelineHtml } from "./timeline.ts";

/**
 * The pass-rate score ring as inline SVG; the green arc animates in (unless reduced motion). Pure.
 *
 * @param passed Expectations passed, e.g. 2.
 * @param total  Expectations judged, e.g. 3.
 * @returns      SVG markup.
 */
function ring(passed: number, total: number): string {
  const r = 15.9155,
    f = total ? (passed / total) * 100 : 0;
  const c = (cls: string, extra = "") =>
    `<circle class="${cls}" cx="18" cy="18" r="${r}" fill="none" stroke-width="3.2"${extra}/>`;
  return (
    `<svg class="score" viewBox="0 0 36 36" role="img" aria-label="${passed} of ${total} passed">` +
    c(total && passed < total ? "track" : "track none") +
    (f ? c("fill", ` stroke-dasharray="${f} ${100 - f}" transform="rotate(-90 18 18)"`) : "") +
    `<text x="18" y="20.8" text-anchor="middle">${Math.round(f)}%</text></svg>`
  );
}

/**
 * The hero tile: the score ring, a headline, and a celebratory spark when every expectation passed. Pure.
 *
 * @param passed Expectations passed.
 * @param total  Expectations judged.
 * @returns      HTML.
 */
function heroHtml(passed: number, total: number): string {
  const failing = total - passed;
  const head = !total
    ? `<p class="headline">No verdicts yet</p>`
    : failing
      ? `<p class="headline bad">${failing} failing</p>`
      : `<p class="headline"><span class="spark" aria-hidden="true">✦</span> All ${total} passed</p>`;
  const sub = total ? `<p class="muted">${passed} passed · ${failing} failed</p>` : "";
  return `<div class="tile hero">${ring(passed, total)}<div><p class="kicker">Pass rate</p>${head}${sub}</div></div>`;
}

// Re-checks the heartbeat on load; makes resume commands keyboard-operable copy buttons with brief feedback.
const JS = `document.querySelectorAll('.status[data-beat]').forEach(s=>{if(Date.now()-Number(s.dataset.beat)>=${STALE_MS}){s.textContent='not running';s.className='pill na status';document.querySelectorAll('.dot.pulse').forEach(d=>d.classList.remove('pulse'))}});document.querySelectorAll('code.copy').forEach(c=>{c.tabIndex=0;c.setAttribute('role','button');const go=()=>navigator.clipboard&&navigator.clipboard.writeText(c.textContent).then(()=>{c.classList.add('copied');setTimeout(()=>c.classList.remove('copied'),1200)});c.onclick=go;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}}});`;

/**
 * The models per role and any other run-level sessions, folded. Pure.
 *
 * @param view The run view.
 * @returns    HTML, or "" if run.json names no settings.
 */
function settingsHtml(view: RunView): string {
  const st = view.run.settings ?? {};
  const roles = ["constructor", "executor", "destructor"]
    .filter((r) => st[r])
    .map((r) => [r, st[r]] as const)
    .concat((Array.isArray(st.judge) ? st.judge : []).map((j: Loose) => ["judge", j] as const));
  const other = Object.entries(view.sessions).filter(([k]) => k !== "constructor" && k !== "destructor");
  if (!roles.length && !other.length) return "";
  const rows = roles.map(
    ([r, p]) => `<tr><th scope="row">${esc(r)}</th><td>${esc(p?.model)} · ${esc(p?.effort)}</td></tr>`,
  );
  const ver = view.run.claudeVersion ? `<p class="muted">${esc(view.run.claudeVersion)}</p>` : "";
  return (
    `<section class="card"><details><summary>Models</summary>` +
    `<table><tbody>${rows.join("")}</tbody></table>${ver}${sessionsHtml(other)}</details></section>`
  );
}

/**
 * The run status pill at the top: completed, running, or not running (no finish time and no recent heartbeat).
 * Pure: "running" is decided at render time from run.json; the page script re-checks the beat on every load.
 *
 * @param run run.json contents.
 * @param now Render time in ms, e.g. Date.now().
 * @returns   HTML.
 */
export function statusHtml(run: Loose, now: number): string {
  if (run.finished) return `<p><span class="pill ok status">completed</span></p>`;
  const beat = Date.parse(run.heartbeat ?? run.started ?? ""),
    live = alive(run, now);
  const attr = Number.isFinite(beat) ? ` data-beat="${beat}"` : "";
  return `<p><span class="pill ${live ? "run" : "na"} status"${attr}>${live ? "running" : "not running"}</span></p>`;
}

/**
 * The red banner when setup failed. Pure.
 *
 * @param view The run view.
 * @returns    HTML, or "" if setup didn't fail.
 */
function setupBanner(view: RunView): string {
  const run = view.run,
    c = view.constructor;
  if (run.setup !== "failed") return "";
  const why = run.setupError ?? (c ? (c.ok ? c.data.notes : c.error) : "unknown reason");
  return `<div class="banner" role="alert">Setup failed: ${esc(why)}</div>`;
}

/**
 * The summary tiles: pass-rate ring, expectations passed, total time, total cost, LLM calls. Pure.
 *
 * @param view The run view.
 * @returns    HTML.
 */
function tilesHtml(view: RunView): string {
  const run = view.run;
  const all = view.cujs.flatMap((c) => c.outcomes),
    passed = all.filter((o) => o.pass === true).length;
  const sess = [...Object.values(view.sessions), ...view.cujs.flatMap((c) => c.sessions.map(([, s]) => s))];
  const sumMs = sess.reduce((a, s) => a + (Number(s?.ms) || 0), 0);
  const wall = run.started && run.finished ? Date.parse(run.finished) - Date.parse(run.started) : NaN;
  const time = sumMs ? fmtMs(sumMs) : Number.isFinite(wall) ? fmtMs(wall) : "—";
  const usd = sess.some((s) => typeof s?.costUsd === "number")
    ? fmtUsd(sess.reduce((a, s) => a + (Number(s?.costUsd) || 0), 0))
    : "—";
  return (
    `<section class="tiles${all.length && passed === all.length ? " allpass" : ""}" aria-label="Summary">` +
    `${heroHtml(passed, all.length)}<div class="tile"><b>${passed}/${all.length}</b>expectations passed</div>` +
    `<div class="tile"><b>${esc(time)}</b>total time</div><div class="tile"><b>${esc(usd)}</b>total cost</div>` +
    `<div class="tile"><b>${sess.length}</b>LLM calls</div></section>`
  );
}

/**
 * A card of folded text files, e.g. the debug section. Pure.
 *
 * @param title Card title, e.g. "Debug".
 * @param files The files.
 * @returns     HTML, or "" if there are none.
 */
function filesCard(title: string, files: FileText[]): string {
  if (!files.length) return "";
  const one = (f: FileText) => `<details><summary>${esc(f.path)}</summary><pre>${esc(f.text)}</pre></details>`;
  return `<section class="card"><h2>${esc(title)}</h2>${files.map(one).join("")}</section>`;
}

/**
 * The header's run window, e.g. "2026-11-10 · 02:19:25 → 02:20:42 UTC". Pure.
 *
 * @param started  run.started, ISO.
 * @param finished run.finished, ISO, or undefined while running.
 * @returns        HTML with machine-readable <time> elements.
 */
function whenHtml(started: string, finished: string | undefined): string {
  const ok = (iso: string) => Number.isFinite(Date.parse(iso));
  const t = (iso: string) =>
    ok(iso) ? `<time datetime="${esc(iso)}">${new Date(iso).toISOString().slice(11, 19)}</time>` : esc(iso);
  const day = ok(started) ? `${new Date(started).toISOString().slice(0, 10)} · ` : "";
  return `${day}${t(started)} → ${finished ? t(finished) : "running"} UTC`;
}

/**
 * Render the whole report page from a typed view. Pure.
 *
 * @param view What loadRun returned.
 * @returns    The full HTML document.
 */
export function renderReport(view: RunView, now = Date.now()): string {
  const run = view.run;
  const when = run.started ? whenHtml(run.started, run.finished) : esc(view.dir.split(/[\\/]/).filter(Boolean).at(-1));
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    (run.finished ? "" : `<meta http-equiv="refresh" content="5">`) +
    `<title>${esc(run.subject ?? "run")} report</title><style>${TAILWIND_CSS}</style></head><body>` +
    `<header class="bar"><div class="bar-in"><h1>${esc(run.subject ?? "unknown subject")}</h1>${statusHtml(run, now)}` +
    `<p class="muted">${when}</p></div></header><main class="page">` +
    setupBanner(view) +
    tilesHtml(view) +
    timelineHtml(view, now) +
    settingsHtml(view) +
    filesCard("Debug", view.raw) +
    filesCard("Other files", view.unknown) +
    `</main><script>${JS}</script></body></html>`
  );
}
