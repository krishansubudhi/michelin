// Compare: `michelin compare <run> <run> [...]`, a blind head-to-head of finished runs (docs/compare.md).
//
// Every pair of runs (round robin) meets on every CUJ both ran. A panel of judges sees the two journeys with every
// identifier scrubbed to "Program A" / "Program B", once in each order (pair.ts), and picks the better one. The
// games are tallied into a win rate and an Elo rating per run.
//
// Writes .runs/compare-<ISO>/ under the current folder:
//   compare.json            the runs, judges, standings, every game and the total judge cost
//   compare.md              the win-rate table, then each game's winner and every judge's reasons
//   report.html             the same as one page (compare-html.ts)
//   <cuj>/<x>-vs-<y>/       judgePair's prompts and each judge's two verdicts
//   llm.log                 the judges' CLI stderr
//
// Test: npm test (compare.test.ts, fake LLM).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { readEvidence } from "../llm/judge.ts";
import type { LlmOpts, LlmResult, Pick } from "../llm/models.ts";
import { judgePair, type Evidence, type PairVerdict, type Task } from "../llm/pair.ts";
import { identifiers } from "../llm/scrub.ts";
import { compareHtml } from "../report/compare-html.ts";
import { fmtUsd } from "../report/html.ts";
import type { Loose } from "../report/view.ts";
import { UsageError } from "./cli.ts";
import { loadConfig } from "./settings.ts";

/** One run in a comparison: its name, folder, identifiers to hide, and per CUJ id its evidence and task. */
export type Side = {
  name: string;
  dir: string;
  ids: string[];
  cujs: Record<string, { evidence: Evidence; task: Task }>;
};

/** One game: two runs (by name) on one CUJ, the panel's winner (null: no valid verdict) and each judge's verdicts. */
export type Game = {
  cuj: string;
  a: string;
  b: string;
  winner: "a" | "b" | "tie" | null;
  judges: Record<string, PairVerdict>;
};

/** One run's standing: wins, losses, ties, decided games, win rate (wins + ties/2 over decided games) and Elo. */
export type Row = {
  name: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  winRate: number;
  elo: number;
};

/** How compare calls an LLM: the real llm(), or a test fake; it is given a logPath in the out folder. */
type CompareLlm = (pick: Pick, prompt: string, opts?: LlmOpts) => Promise<LlmResult>;

/**
 * Read a JSON file, or undefined if it is missing or not valid JSON.
 *
 * @param path The file, e.g. ".runs/x/run.json".
 * @returns    Its parsed value, or undefined.
 */
function readJson(path: string): Loose {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Split a run argument into its name and folder. Pure.
 *
 * @param arg "dir" or "name=dir", e.g. "gemma=.runs/2026-11-17T10-00-00-000Z".
 * @returns   {name, dir}, name undefined when not given, e.g. {name: "gemma", dir: ".runs/2026-..."}.
 */
export function parseRunArg(arg: string): { name?: string; dir: string } {
  const m = /^([^=/\\]+)=(.+)$/.exec(arg);
  return m ? { name: m[1], dir: m[2] } : { dir: arg };
}

/**
 * The CUJ ids a run holds: its run.json defs keys and every sub-folder with an executor.json.
 *
 * @param dir The run folder.
 * @param run Its run.json, e.g. {defs: {"toy-country": {...}}}.
 * @returns   The ids, sorted, e.g. ["toy-country"].
 */
function cujIds(dir: string, run: Loose): string[] {
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "executor.json")))
    .map((e) => e.name);
  return [...new Set([...Object.keys(run?.defs ?? {}), ...folders])].sort();
}

/**
 * One CUJ of a run, for comparison: the executor's evidence and the task it was given.
 *
 * @param dir The run folder.
 * @param id  The CUJ id, e.g. "toy-country".
 * @param run Its run.json; defs[id].instruction is the instruction.
 * @returns   evidence (an unreadable executor.json becomes a reply saying so) and task, whose expectations are the
 *            <id>/verdict.json texts, [] if none.
 */
function cujEntry(dir: string, id: string, run: Loose): Side["cujs"][string] {
  const ev = readEvidence(join(dir, id));
  const verdict = readJson(join(dir, id, "verdict.json"));
  const expectations = Array.isArray(verdict) ? verdict.map((o) => String(o?.expectation ?? "")) : [];
  return {
    evidence: ev.error === undefined ? ev : { journey: "", reply: `(evidence unreadable: ${ev.error})` },
    task: { instruction: String(run.defs?.[id]?.instruction ?? ""), expectations },
  };
}

/**
 * Load one run for comparison.
 *
 * @param dir  The run folder, e.g. "/repo/.runs/2026-11-17T10-00-00-000Z"; must hold run.json.
 * @param name What to call it, e.g. "gemma"; hidden from the judges like the run's own identifiers.
 * @param hide More strings to hide (--hide), e.g. ["my-laptop"].
 * @returns    The side: per CUJ the executor's evidence, the instruction (run.json defs) and the expectations
 *             (<cuj>/verdict.json texts, [] if none).
 * @throws     If dir has no readable run.json.
 */
export function loadSide(dir: string, name: string, hide: string[] = []): Side {
  const run = readJson(join(dir, "run.json"));
  if (!run || typeof run !== "object") throw new Error(`${join(dir, "run.json")}: missing or not valid JSON`);
  const notes = readJson(join(dir, "constructor.json"))?.data?.notes;
  const ids = identifiers(dir, run, typeof notes === "string" ? notes : "", [...hide, name]);
  const cujs = Object.fromEntries(cujIds(dir, run).map((id) => [id, cujEntry(dir, id, run)]));
  return { name, dir, ids, cujs };
}

/**
 * Name every run: its given name, else its subject's folder name, with "#<n>" (1-based position) where that clashes.
 *
 * @param args The run arguments, e.g. ["a=.runs/1", ".runs/2"].
 * @param cwd  The folder relative dirs start from, e.g. process.cwd().
 * @returns    [name, absolute dir] per run, in order, e.g. [["a", "/r/.runs/1"], ["opencode", "/r/.runs/2"]].
 * @throws     A UsageError if two runs end up with the same name.
 */
function nameRuns(args: string[], cwd: string): [string, string][] {
  const parsed = args.map((a) => {
    const { name, dir } = parseRunArg(a);
    const abs = resolve(cwd, dir);
    const subject = readJson(join(abs, "run.json"))?.subject;
    return { name, dir: abs, auto: basename(typeof subject === "string" ? subject : abs) };
  });
  const count = (n: string) => parsed.filter((p) => !p.name && p.auto === n).length;
  const named = parsed.map((p, i): [string, string] => [
    p.name ?? (count(p.auto) > 1 ? `${p.auto}#${i + 1}` : p.auto),
    p.dir,
  ]);
  const names = named.map(([n]) => n);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new UsageError(`two runs are both named "${dup}"; name them, e.g. a=<dir> b=<dir>`);
  return named;
}

/**
 * Every pair of n players, each once. Pure.
 *
 * @param n How many, e.g. 3.
 * @returns All [i, j] with i < j, e.g. [[0, 1], [0, 2], [1, 2]].
 */
export function roundRobin(n: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  return pairs;
}

/**
 * Tally games into standings: wins, losses, ties, win rate and Elo (start 1000, K 32, in game order). Pure.
 *
 * @param names Every run's name, e.g. ["gemma", "qwen"].
 * @param games The games, e.g. [{cuj: "toy-country", a: "gemma", b: "qwen", winner: "a", judges: {}}];
 *              a null winner counts for nothing.
 * @returns     One row per name, best first: by win rate, then Elo.
 */
export function standings(names: string[], games: Game[]): Row[] {
  const rows = new Map(
    names.map((name) => [name, { name, wins: 0, losses: 0, ties: 0, games: 0, winRate: 0, elo: 1000 }]),
  );
  for (const g of games) {
    const a = rows.get(g.a)!,
      b = rows.get(g.b)!;
    if (g.winner === null) continue;
    const sa = g.winner === "a" ? 1 : g.winner === "b" ? 0 : 0.5;
    const ea = 1 / (1 + 10 ** ((b.elo - a.elo) / 400));
    [a.elo, b.elo] = [a.elo + 32 * (sa - ea), b.elo + 32 * (1 - sa - (1 - ea))];
    if (g.winner === "tie") [a.ties, b.ties] = [a.ties + 1, b.ties + 1];
    else if (sa) [a.wins, b.losses] = [a.wins + 1, b.losses + 1];
    else [b.wins, a.losses] = [b.wins + 1, a.losses + 1];
    [a.games, b.games] = [a.games + 1, b.games + 1];
  }
  for (const r of rows.values()) r.winRate = r.games ? (r.wins + r.ties / 2) / r.games : 0;
  return [...rows.values()].sort((x, y) => y.winRate - x.winRate || y.elo - x.elo);
}

/**
 * The win-rate table as markdown. Pure.
 *
 * @param rows From standings().
 * @returns    A table: run, W-L-T, win rate %, Elo, e.g. "| gemma | 1-0-0 | 100% | 1016 |".
 */
export function table(rows: Row[]): string {
  const line = (r: Row) =>
    `| ${r.name} | ${r.wins}-${r.losses}-${r.ties} | ${Math.round(r.winRate * 100)}% | ${Math.round(r.elo)} |`;
  return ["| run | W-L-T | win rate | Elo |", "| --- | --- | --- | --- |", ...rows.map(line)].join("\n");
}

/**
 * The comparison as markdown: the table, the total judge cost, then each game's winner and judges' reasons. Pure.
 *
 * @param rows    From standings().
 * @param games   The games; each judge saw A/B, reported here with the run names restored.
 * @param costUsd Total judge cost in USD, e.g. 0.42.
 * @returns       The markdown, no # title line.
 */
export function compareMd(rows: Row[], games: Game[], costUsd: number): string {
  const name = (g: Game, side: string | null, first: "A" | "B") =>
    side === "tie" ? "tie" : side === null ? "no valid verdict" : side === first ? g.a : g.b;
  const game = (g: Game) => {
    const won = g.winner === null ? "no valid verdict" : g.winner === "tie" ? "tie" : g.winner === "a" ? g.a : g.b;
    const judges = Object.entries(g.judges).map(
      ([m, v]) =>
        `- ${m}: ${v.result ?? "no result"}\n  - ${g.a} shown as A: ${name(g, v.ab, "A")}. ${v.whyAB}\n` +
        `  - ${g.a} shown as B: ${name(g, v.ba, "B")}. ${v.whyBA}`,
    );
    return `## ${g.cuj}: ${g.a} vs ${g.b}\n\nWinner: ${won}\n\n${judges.join("\n")}`;
  };
  return [table(rows), `Total judge cost: ${fmtUsd(costUsd)}`, ...games.map(game)].join("\n\n") + "\n";
}

/**
 * A name safe as a folder name. Pure.
 *
 * @param s A run name, e.g. "opencode#2".
 * @returns e.g. "opencode_2".
 */
const safe = (s: string) => s.replace(/[^\w.-]/g, "_");

/**
 * The program for `michelin compare`: load every run, judge every pair on every CUJ both ran, write the results and
 * print the table, the total judge cost and the out folder.
 *
 * @param args From parseCli: runs ("dir" or "name=dir"), settingsPath, flags.judges, hide.
 * @param llm  How to call an LLM: the real llm(), or a test fake.
 * @param cwd  Where relative paths start and .runs/compare-<ISO>/ is made, e.g. process.cwd().
 * @returns    The out folder, the standings, the games and the total judge cost in USD.
 * @throws     A UsageError on clashing run names; an Error on a run folder without run.json or bad settings.
 */
export async function compareMain(
  args: { runs: string[]; settingsPath?: string; flags: { judges?: string }; hide: string[] },
  llm: CompareLlm,
  cwd = process.cwd(),
): Promise<{ out: string; rows: Row[]; games: Game[]; costUsd: number }> {
  const { settings, pairJudges } = loadConfig({ settingsPath: args.settingsPath, flags: args.flags, cwd });
  const judges = args.flags.judges ? settings.judge : settings.judge.slice(0, pairJudges);
  const sides = nameRuns(args.runs, cwd).map(([name, dir]) => loadSide(dir, name, args.hide));
  const out = join(cwd, ".runs", `compare-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(out, { recursive: true });
  const logged: CompareLlm = (p, prompt, o) => llm(p, prompt, { ...o, logPath: join(out, "llm.log") });
  const games: Game[] = [];
  let costUsd = 0;
  for (const [i, j] of roundRobin(sides.length)) {
    const [x, y] = [sides[i], sides[j]];
    for (const cuj of Object.keys(x.cujs).filter((id) => id in y.cujs)) {
      const [tx, ty] = [x.cujs[cuj].task, y.cujs[cuj].task];
      const task = {
        instruction: tx.instruction || ty.instruction,
        expectations: tx.expectations.length ? tx.expectations : ty.expectations,
      };
      const first = { evidence: x.cujs[cuj].evidence, ids: x.ids };
      const second = { evidence: y.cujs[cuj].evidence, ids: y.ids };
      const dir = join(out, safe(cuj), `${safe(x.name)}-vs-${safe(y.name)}`);
      const r = await judgePair(logged, judges, dir, { task, first, second });
      costUsd += r.costUsd;
      const winner = r.winner === "first" ? "a" : r.winner === "second" ? "b" : r.winner;
      games.push({ cuj, a: x.name, b: y.name, winner, judges: r.judges });
    }
  }
  const rows = standings(
    sides.map((s) => s.name),
    games,
  );
  const runs = sides.map(({ name, dir }) => ({ name, dir }));
  writeFileSync(join(out, "compare.json"), JSON.stringify({ runs, judges, rows, games, costUsd }, null, 2));
  writeFileSync(join(out, "compare.md"), compareMd(rows, games, costUsd));
  writeFileSync(join(out, "report.html"), compareHtml(rows, games, costUsd));
  console.log(`${table(rows)}\n\n${games.length} game(s), total judge cost ${fmtUsd(costUsd)}\ncompare dir: ${out}`);
  return { out, rows, games, costUsd };
}
