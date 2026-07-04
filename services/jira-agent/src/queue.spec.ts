import { describe, expect, it, vi } from "vitest";
import { TicketQueue } from "./queue.js";
import { createTestLogger } from "./testing/test-logger.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("TicketQueue", () => {
  it("processes events serially in FIFO order", async () => {
    const queue = new TicketQueue(createTestLogger().logger);
    const seen: string[] = [];
    queue.start(async (event) => {
      seen.push(event.issueKey);
    });

    queue.enqueue({ issueKey: "IT-1", trigger: "assigned" });
    queue.enqueue({ issueKey: "IT-2", trigger: "assigned" });
    await queue.onIdle();

    expect(seen).toEqual(["IT-1", "IT-2"]);
  });

  it("dedupes keys that are already queued or in flight", async () => {
    const queue = new TicketQueue(createTestLogger().logger);
    const gate = deferred();
    const seen: string[] = [];
    queue.start(async (event) => {
      seen.push(event.issueKey);
      if (event.issueKey === "IT-1") await gate.promise;
    });

    expect(queue.enqueue({ issueKey: "IT-1", trigger: "assigned" })).toBe(true);
    // IT-1 is now in flight; a duplicate must be dropped.
    expect(queue.enqueue({ issueKey: "IT-1", trigger: "assigned" })).toBe(false);
    expect(queue.enqueue({ issueKey: "IT-2", trigger: "assigned" })).toBe(true);
    expect(queue.enqueue({ issueKey: "IT-2", trigger: "reprocess" })).toBe(false);
    expect(queue.depth).toBe(2);

    gate.resolve();
    await queue.onIdle();
    expect(seen).toEqual(["IT-1", "IT-2"]);
  });

  it("a failing processor does not kill the worker loop", async () => {
    const { logger, error } = createTestLogger();
    const queue = new TicketQueue(logger);
    const seen: string[] = [];
    queue.start(async (event) => {
      if (event.issueKey === "IT-1") throw new Error("boom");
      seen.push(event.issueKey);
    });

    queue.enqueue({ issueKey: "IT-1", trigger: "assigned" });
    queue.enqueue({ issueKey: "IT-2", trigger: "assigned" });
    await queue.onIdle();

    expect(seen).toEqual(["IT-2"]);
    expect(error).toHaveBeenCalledOnce();
  });

  it("stop() blocks intake, waits for the in-flight event and drops pending ones", async () => {
    const queue = new TicketQueue(createTestLogger().logger);
    const gate = deferred();
    const seen: string[] = [];
    queue.start(async (event) => {
      await gate.promise;
      seen.push(event.issueKey);
    });

    queue.enqueue({ issueKey: "IT-1", trigger: "assigned" });
    queue.enqueue({ issueKey: "IT-2", trigger: "assigned" });
    const stopping = queue.stop();
    gate.resolve();
    await stopping;

    // IT-1 (in flight) finished, IT-2 stayed pending, new intake refused.
    expect(seen).toEqual(["IT-1"]);
    expect(queue.enqueue({ issueKey: "IT-3", trigger: "assigned" })).toBe(false);
  });

  it("stop() gives up after the deadline when the in-flight event hangs", async () => {
    vi.useFakeTimers();
    try {
      const queue = new TicketQueue(createTestLogger().logger);
      queue.start(() => new Promise<never>(() => {}));
      queue.enqueue({ issueKey: "IT-1", trigger: "assigned" });

      let stopped = false;
      const stopping = queue.stop(1000).then(() => {
        stopped = true;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await stopping;
      expect(stopped).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
