import type { Logger } from "@fredy/agent-core";
import type { TicketEvent } from "./agent/types.js";

export type TicketEventProcessor = (event: TicketEvent) => Promise<void>;

/**
 * Serial in-process queue keyed by issue key: enqueueing a key that is
 * already queued or in flight is a no-op, which closes the webhook/poller
 * race. Concurrency is deliberately 1 — it keeps the label claim protocol
 * free of in-process races and serialises LLM pressure.
 */
export class TicketQueue {
  private readonly pending: TicketEvent[] = [];
  private readonly queuedKeys = new Set<string>();
  private inFlightKey: string | null = null;
  private accepting = true;
  private running = false;
  private drainPromise: Promise<void> = Promise.resolve();
  private processor?: TicketEventProcessor;

  constructor(private readonly logger: Logger) {}

  /** Returns false when deduped or when intake is stopped. */
  enqueue(event: TicketEvent): boolean {
    if (!this.accepting) return false;
    if (this.queuedKeys.has(event.issueKey) || this.inFlightKey === event.issueKey) {
      this.logger.debug(`Queue dedupe: ${event.issueKey} already queued or in flight`);
      return false;
    }
    this.pending.push(event);
    this.queuedKeys.add(event.issueKey);
    this.kick();
    return true;
  }

  start(processor: TicketEventProcessor): void {
    this.processor = processor;
    this.kick();
  }

  /** Stops intake and waits for the in-flight ticket up to the deadline. */
  async stop(deadlineMs = 30_000): Promise<void> {
    this.accepting = false;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, deadlineMs);
      timer.unref();
    });
    await Promise.race([this.drainPromise, deadline]);
    clearTimeout(timer);
  }

  get depth(): number {
    return this.pending.length + (this.inFlightKey ? 1 : 0);
  }

  /** Resolves when the current drain run finishes. */
  async onIdle(): Promise<void> {
    await this.drainPromise;
  }

  private kick(): void {
    if (!this.processor || this.running || this.pending.length === 0) return;
    this.running = true;
    this.drainPromise = this.drain().finally(() => {
      this.running = false;
    });
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0 && this.accepting) {
      const event = this.pending.shift();
      if (!event) break;
      this.queuedKeys.delete(event.issueKey);
      this.inFlightKey = event.issueKey;
      try {
        await this.processor?.(event);
      } catch (error) {
        // The processor owns per-ticket error handling; this guard only keeps
        // one poisoned ticket from killing the worker loop.
        this.logger.error(
          { err: error },
          `Ticket processing failed for ${event.issueKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        this.inFlightKey = null;
      }
    }
  }
}
