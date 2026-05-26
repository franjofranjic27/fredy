import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { EvalCaseSchema, type EvalCase } from "./types.js";

export class DatasetNotFoundError extends Error {
  constructor(path: string) {
    super(
      `Eval dataset not found at "${path}". ` +
        "Run the dataset generator first: `pnpm --filter @fredy/eval generate-dataset`.",
    );
    this.name = "DatasetNotFoundError";
  }
}

export class DatasetParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly lineNumber: number,
    public readonly reason: string,
  ) {
    super(`Invalid eval case in ${path} at line ${lineNumber}: ${reason}`);
    this.name = "DatasetParseError";
  }
}

export async function loadDataset(path: string): Promise<EvalCase[]> {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    throw new DatasetNotFoundError(absolutePath);
  }

  const cases: EvalCase[] = [];
  const seenIds = new Set<string>();
  const stream = createReadStream(absolutePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNumber = 0;
  for await (const rawLine of lines) {
    lineNumber++;
    const trimmed = rawLine.trim();
    if (trimmed.length === 0) continue;

    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DatasetParseError(absolutePath, lineNumber, `Malformed JSON: ${message}`);
    }

    const parsed = EvalCaseSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
        .join("; ");
      throw new DatasetParseError(absolutePath, lineNumber, issues);
    }

    if (seenIds.has(parsed.data.queryId)) {
      throw new DatasetParseError(
        absolutePath,
        lineNumber,
        `Duplicate queryId "${parsed.data.queryId}"`,
      );
    }
    seenIds.add(parsed.data.queryId);
    cases.push(parsed.data);
  }

  if (cases.length === 0) {
    throw new DatasetParseError(absolutePath, lineNumber, "Dataset is empty");
  }

  return cases;
}
