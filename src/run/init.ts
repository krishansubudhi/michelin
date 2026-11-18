// `michelin init`: start a project in the current folder. Writes a starter michelin.json holding only what differs from
// the built-in defaults (the toy subject and its CUJ folder; runs, executor and judges come from defaults/settings.json)
// and copies the package's toy subject to ./subjects/toy. Never overwrites: an existing michelin.json or subjects/toy is kept and reported.
//
// Test: node --test test/init.test.ts

import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This package's root folder, e.g. "/x/node_modules/michelin-eval/"; holds subjects/toy. */
export const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The starter michelin.json: only what differs from the defaults, the toy subject and its CUJ folder. Pure.
 *
 * @returns Its contents as pretty JSON, ending in a newline.
 */
export function starter(): string {
  const config = { subject: "subjects/toy", cujs: ["subjects/toy/cujs/toy/"] };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Make `path` unless it already exists.
 *
 * @param path The file or folder, e.g. "/proj/michelin.json".
 * @param done What to report once made, e.g. "wrote michelin.json".
 * @param make Makes it, e.g. () => writeFileSync(path, text).
 * @returns    `done`, or "kept existing <name>" if it was there, e.g. "kept existing michelin.json".
 */
function unlessExists(path: string, done: string, make: () => void): string {
  if (existsSync(path)) return `kept existing ${done.split(" ")[1]}`;
  make();
  return done;
}

/**
 * Write michelin.json and copy the toy subject into `cwd`, skipping whichever already exists, and print what it did.
 *
 * @param cwd     The project folder, e.g. process.cwd().
 * @param pkgRoot The michelin package's root, holding subjects/toy, e.g. PKG_ROOT.
 * @returns       The lines it printed, e.g. ["wrote michelin.json", "kept existing subjects/toy", "next: ..."].
 */
export function init(cwd: string, pkgRoot: string): string[] {
  const config = join(cwd, "michelin.json");
  const toy = join(cwd, "subjects", "toy");
  const lines = [
    unlessExists(config, "wrote michelin.json", () => writeFileSync(config, starter(), { flag: "wx" })),
    unlessExists(toy, "copied subjects/toy", () => cpSync(join(pkgRoot, "subjects", "toy"), toy, { recursive: true })),
    "next: michelin run",
  ];
  for (const l of lines) console.log(l);
  return lines;
}
