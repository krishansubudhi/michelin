// A CUJ's given: the state of the world before it starts. Setup seeds it into the subject; the executor (playing
// the user) and the judges are told it; the subject never is. One run has one setup, so its CUJs share one given.
//
// Test: npm test (given.test.ts, no LLM).

import type { Cuj } from "./cujs.ts";

/** A CUJ's given, e.g. {memory: ["..."], health: {sleep_h: 5}}. */
export type Given = Record<string, unknown>;

/** The line the constructor writes in its notes for each given key it seeded, e.g. "given memory: seeded". */
const seededLine = (key: string) => `given ${key}: seeded`;

/**
 * The one given a run seeds: CUJs that share a run (one setup) must all have the same given, or none. Pure.
 *
 * @param cujs [path, cuj] pairs of one run.
 * @returns    Their shared given, or undefined if none has one.
 * @throws     If two differ, naming both files.
 */
export function sharedGiven(cujs: readonly (readonly [string, Cuj])[]): Given | undefined {
  const key = ([, c]: readonly [string, Cuj]) => JSON.stringify(c.given ?? null);
  const odd = cujs.find((x) => key(x) !== key(cujs[0]));
  if (odd)
    throw new Error(
      `${cujs[0][0]} and ${odd[0]} have different given: state, but files listed one by one share one setup; give their folder for a run each`,
    );
  return cujs[0]?.[1].given;
}

/**
 * The constructor's instructions for a given. Pure.
 *
 * @param given The run's given.
 * @returns     Prompt paragraphs: the given as JSON, then how to seed it and report each key.
 */
export const seedNote = (given: Given) => [
  `Given, the state of the world before the CUJ starts:\n${JSON.stringify(given, null, 2)}`,
  `After setup, seed this given state into the subject as setup.md's "Seed given" section says. In notes, report each key on its own line: "${seededLine("<key>")}" or "given <key>: FAIL <why>". Any key not seeded means setup failed: return ok: false.`,
];

/**
 * The executor's note on a given: it plays the user, so it answers consistently with it. Pure.
 *
 * @param given The CUJ's given.
 * @returns     One prompt paragraph.
 */
export const playNote = (given: Given) =>
  `State seeded into the program before your task (you play the user: answer consistently with it; never tell it to the program unless the task says to):\n${JSON.stringify(given, null, 2)}`;

/**
 * Which given keys setup did not report seeded. Pure.
 *
 * @param given The run's given, or undefined.
 * @param notes The constructor's notes, e.g. "given memory: seeded\ngiven clock: FAIL no fake clock".
 * @returns     The keys with no "given <key>: seeded" line, e.g. ["clock"].
 */
export const unseeded = (given: Given | undefined, notes: string) =>
  Object.keys(given ?? {}).filter((k) => !notes.includes(seededLine(k)));
