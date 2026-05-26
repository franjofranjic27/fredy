import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { GoldenRecord } from "./types.js";

/**
 * Serialize records to JSONL and write atomically.
 *
 * WHY write-then-rename: a half-finished `.jsonl` is worse than no file at
 * all, because downstream eval runs would silently load a partial dataset.
 * `rename` within the same filesystem is atomic on POSIX, so readers either
 * see the previous file or the complete new one.
 */
export async function writeJsonl(path: string, records: readonly GoldenRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  const body = records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");
  await writeFile(tempPath, body, "utf8");
  await rename(tempPath, path);
}
