import { vi } from "vitest";
import type { Logger } from "../logging/logger.js";

export interface CapturingLogger {
  logger: Logger;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}

/** Silent logger with spies — avoids booting pino-pretty workers in tests. */
export function createTestLogger(): CapturingLogger {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  const logger = {
    info,
    warn,
    error,
    debug,
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: "silent",
    child: (): unknown => logger,
  } as unknown as Logger;
  return { logger, info, warn, error, debug };
}
