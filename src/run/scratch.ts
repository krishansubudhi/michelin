// The subject's throwaway space: <tmp>/michelin-<user>/runs/<runid>/ ($MICHELIN_TMP/runs/<runid>/ when set), made before setup and removed after teardown.
// Results never go here; they stay in .runs/<runid>/.
//
// Test: npm test (scratch.test.ts, no LLM).

import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";

/**
 * Michelin's temp folder for the run lock and scratch space. Pure.
 * Per OS user by default, so a folder another user made can never fail with EACCES; set MICHELIN_TMP to one shared
 * folder (chmod 1777) to hold a single run lock across users.
 *
 * @param env  The environment, e.g. process.env; MICHELIN_TMP wins when set and non-empty.
 * @param tmp  The OS temp folder, e.g. "/tmp".
 * @param user The OS user name, e.g. "agent".
 * @returns    e.g. "/tmp/michelin-agent", or $MICHELIN_TMP.
 */
export const tmpRoot = (env: NodeJS.ProcessEnv, tmp: string, user: string) =>
  env.MICHELIN_TMP || join(tmp, `michelin-${user}`);

/** This process's temp folder: $MICHELIN_TMP, else <os temp>/michelin-<user>. */
export const TMP_ROOT = tmpRoot(process.env, tmpdir(), userInfo().username);

/** Where every run's scratch folder lives. */
export const SCRATCH_ROOT = join(TMP_ROOT, "runs");

/**
 * The scratch folder for one run. Pure.
 * The CUJ's id is hashed, never spelled out: the agent works in this folder, and a name like
 * "...-remembers_pairing_key" tells it what is being tested.
 *
 * @param runDir The run's output folder, e.g. ".runs/2026-11-10T02-58-00-000Z".
 * @param cuj    The CUJ's folder name, e.g. "chat-name"; "" for a run-wide folder.
 * @returns      e.g. "/tmp/michelin-agent/runs/2026-11-10T02-58-00-000Z-3f2a9c1b".
 */
export const scratchFor = (runDir: string, cuj = "") =>
  join(SCRATCH_ROOT, basename(runDir) + (cuj ? `-${createHash("sha256").update(cuj).digest("hex").slice(0, 8)}` : ""));

/**
 * The line setup and teardown read, naming the scratch folder. Pure.
 *
 * @param dir The scratch folder, e.g. "/tmp/michelin-agent/runs/x".
 * @returns   The prompt line.
 */
export const scratchNote = (dir: string) =>
  `RUNDIR=${dir}: this run's folder (exists, empty at setup, deleted after teardown). Where a CUJ or howtorun says $RUNDIR, use this path. Put any install or temp state there, nowhere else in /tmp.`;

/**
 * Make the scratch folder.
 *
 * @param dir The folder, e.g. "/tmp/michelin-agent/runs/x".
 */
export const makeScratch = (dir: string) => mkdirSync(dir, { recursive: true });

/**
 * Delete the scratch folder, if it is still there.
 *
 * @param dir The folder, e.g. "/tmp/michelin-agent/runs/x".
 */
export const dropScratch = (dir: string) => rmSync(dir, { recursive: true, force: true });
