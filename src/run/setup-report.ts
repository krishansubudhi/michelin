import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The constructor's result as text for the executor and destructor, e.g. its notes naming the port and temp folder.
 *
 * @param dir The run folder.
 * @returns   constructor.json's data as JSON, or "" if setup wrote nothing usable.
 */
export function setupReport(dir: string): string {
  try {
    const c = JSON.parse(readFileSync(join(dir, "constructor.json"), "utf8"));
    return c.data ? JSON.stringify(c.data, null, 2) : "";
  } catch {
    return "";
  }
}
