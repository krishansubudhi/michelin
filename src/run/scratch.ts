// The subject's throwaway space: /tmp/michelin/runs/<runid>/, made before setup and removed after teardown.
// Results never go here; they stay in .runs/<runid>/.
//
// Test: npm test (scratch.test.ts, no LLM).

import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";

/** Where every run's scratch folder lives. */
export const SCRATCH_ROOT = "/tmp/michelin/runs";

/**
 * The scratch folder for one run. Pure.
 *
 * @param runDir The run's output folder, e.g. ".runs/2026-11-10T02-58-00-000Z".
 * @returns      e.g. "/tmp/michelin/runs/2026-11-10T02-58-00-000Z".
 */
export const scratchFor = (runDir: string) => join(SCRATCH_ROOT, basename(runDir));

/**
 * The line setup and teardown read, naming the scratch folder. Pure.
 *
 * @param dir The scratch folder, e.g. "/tmp/michelin/runs/x".
 * @returns   The prompt line.
 */
export const scratchNote = (dir: string) =>
  `Scratch folder for this run (exists, empty at setup, deleted after teardown): ${dir}. Put any install or temp state there, nowhere else in /tmp.`;

/**
 * Make the scratch folder.
 *
 * @param dir The folder, e.g. "/tmp/michelin/runs/x".
 */
export const makeScratch = (dir: string) => mkdirSync(dir, { recursive: true });

/**
 * Delete the scratch folder, if it is still there.
 *
 * @param dir The folder, e.g. "/tmp/michelin/runs/x".
 */
export const dropScratch = (dir: string) => rmSync(dir, { recursive: true, force: true });
