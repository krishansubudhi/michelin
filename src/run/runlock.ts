// One michelin run per subject at a time: a subject's setup.md may pick ports by scanning up from 8797, which races; different
// subjects run side by side. The lock is <tmp>/michelin-<user>/run-<subject>.lock (lockFor; base RUN_LOCK) ($MICHELIN_TMP/run.lock when set), holding {pid, user, started}. The default folder is per user;
// a MICHELIN_TMP shared by every OS user (sticky 1777) locks across users, so the file is made 0644 by an atomic exclusive link of a fully written temp file.
//
// Test: npm test (runlock.test.ts, no LLM).

import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { TMP_ROOT } from "./scratch.ts";

/** Where the lock lives. */
export const RUN_LOCK = `${TMP_ROOT}/run.lock`;

/** The lock for one subject, e.g. "subjects/agy" -> "/tmp/michelin/run-agy.lock". Pure. */
export const lockFor = (subject: string) => join(dirname(RUN_LOCK), `run-${basename(resolve(subject))}.lock`);

/** True if pid is a live process; EPERM means alive but another user's. */
export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;
const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const holder = (text: string): { pid?: number; user?: string; started?: string } => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

/** Exclusively create the lock with our pid, user and start time. False if it already exists. */
function tryTake(path: string): boolean {
  const tmp = `${path}.${process.pid}`;
  const me = { pid: process.pid, user: userInfo().username, started: new Date().toISOString() };
  writeFileSync(tmp, JSON.stringify(me), { mode: 0o644 });
  try {
    linkSync(tmp, path);
    return true;
  } catch (e) {
    if (errno(e) === "EEXIST") return false;
    throw e;
  } finally {
    unlinkSync(tmp);
  }
}

/** Remove a dead holder's lock, unless it changed since it was read. */
function dropStale(path: string, seen: string) {
  if (readText(path) !== seen) return;
  try {
    unlinkSync(path);
  } catch (e) {
    if (errno(e) === "ENOENT") return;
    throw new Error(`stale run lock ${path} (${seen}) belongs to another user; the sticky bit stops me removing it`, {
      cause: e,
    });
  }
}

/**
 * Wait for the run lock and take it. Warns once ("run lock taken by run ...: waiting", Ctrl-C cancels) if another live run holds it; takes over a
 * lock whose pid is dead. Releases on SIGINT/SIGTERM too.
 *
 * @param path   The lock file (tests pass a temp path).
 * @param pollMs How often to look again while waiting.
 * @returns      release(): removes the lock if it is still ours; safe to call twice.
 */
export async function acquireRunLock(path = RUN_LOCK, pollMs = 5000): Promise<() => void> {
  mkdirSync(dirname(path), { recursive: true });
  let told = false;
  while (!tryTake(path)) {
    const seen = readText(path);
    const h = holder(seen);
    if (h.pid === undefined) {
      await sleep(Math.min(pollMs, 200)); // gone or junk: junk still unchanged after a pause is dropped
      dropStale(path, seen);
    } else if (alive(h.pid)) {
      if (!told)
        console.warn(
          `run lock taken by run ${h.pid} (${h.user}) started ${h.started}: waiting for it to finish (Ctrl-C to cancel)`,
        );
      told = true;
      await sleep(pollMs);
    } else dropStale(path, seen);
  }
  const onSignal = (sig: NodeJS.Signals) => {
    release();
    process.exit(sig === "SIGINT" ? 130 : 143);
  };
  const release = () => {
    process.off("SIGINT", onSignal).off("SIGTERM", onSignal);
    if (holder(readText(path)).pid === process.pid) unlinkSync(path);
  };
  process.on("SIGINT", onSignal).on("SIGTERM", onSignal);
  return release;
}
