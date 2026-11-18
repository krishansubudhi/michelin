// `michelin init`: start a project in the current folder. Writes a starter michelin.json (the toy subject, its CUJ
// folder, one run, the executor and judges from the built-in defaults/settings.json) and copies the package's toy
// subject to ./subjects/toy. Never overwrites: an existing michelin.json or subjects/toy is kept and reported.
//
// Test: node --test test/init.test.ts

import { cpSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings } from "./settings.ts";

/** This package's root folder, e.g. "/x/node_modules/michelin-eval/"; holds subjects/toy. */
export const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The starter michelin.json: the toy subject and its CUJ folder, one run, executor and judges from the defaults.
 *
 * @returns Its contents as pretty JSON, ending in a newline.
 */
export function starter(): string {
  const { executor, judge } = loadSettings();
  const config = { subject: "subjects/toy", cujs: ["subjects/toy/cujs/toy/"], runs: 1, executor, judge };
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
