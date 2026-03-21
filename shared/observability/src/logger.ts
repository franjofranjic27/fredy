export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(options: {
  level?: LogLevel;
  pretty?: boolean;
  /** Override output sink — useful in tests. Defaults to console.log. */
  output?: (line: string) => void;
} = {}): Logger {
  const {
    level = "info",
    pretty = process.env.NODE_ENV !== "production",
    output = console.log,
  } = options;

  const minRank = LEVEL_RANK[level];

  function write(msgLevel: LogLevel, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_RANK[msgLevel] < minRank) return;
    const ts = new Date().toISOString();
    if (pretty) {
      const metaStr = meta
        ? " " + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
        : "";
      output(`[${ts}] ${msgLevel.toUpperCase().padEnd(5)} ${msg}${metaStr}`);
    } else {
      output(JSON.stringify({ ts, level: msgLevel, msg, ...meta }));
    }
  }

  return {
    debug: (msg, meta) => write("debug", msg, meta),
    info: (msg, meta) => write("info", msg, meta),
    warn: (msg, meta) => write("warn", msg, meta),
    error: (msg, meta) => write("error", msg, meta),
  };
}
