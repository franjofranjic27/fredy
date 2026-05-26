import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EvalReport } from "./types.js";

export async function writeReport(report: EvalReport, reportsDir: string): Promise<string> {
  const absoluteDir = resolve(reportsDir);
  await mkdir(absoluteDir, { recursive: true });
  const timestamp = report.generatedAt.replaceAll(":", "-").replaceAll(".", "-");
  const filename = `eval-${timestamp}.json`;
  const filePath = resolve(absoluteDir, filename);
  await writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}
