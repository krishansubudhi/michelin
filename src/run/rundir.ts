// Run folders: .runs/<ISO time>/ per command, <cuj-id>/ per CUJ run; a name already taken gets -2, -3 ...
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Make a new folder at `base`, or `base-2`, `base-3` ... when taken. Atomic: a plain (non-recursive) mkdir fails with
 * EEXIST if another run got there first, even another process in the same millisecond, so no two runs share a folder.
 *
 * @param base The wanted folder, e.g. ".runs/2026-11-22T22-40-00-000Z"; its parent is created if missing.
 * @returns    The folder made, e.g. ".runs/2026-11-22T22-40-00-000Z-2" when the plain name was taken.
 */
export function makeUniqueDir(base: string): string {
  mkdirSync(dirname(base), { recursive: true });
  for (let n = 1; ; n++) {
    const dir = n === 1 ? base : `${base}-${n}`;
    try {
      mkdirSync(dir);
      return dir;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
}
