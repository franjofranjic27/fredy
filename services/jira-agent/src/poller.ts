import type { Logger } from "@fredy/agent-core";
import type { JiraClient } from "./jira/jira-client.js";
import type { TicketQueue } from "./queue.js";
import { LABEL_IN_PROGRESS } from "./labels.js";

export interface JiraPollerDeps {
  readonly client: JiraClient;
  readonly queue: TicketQueue;
  readonly logger: Logger;
  readonly jql: string;
  readonly intervalMs: number;
  readonly projectKey: string;
}

const SEARCH_PAGE_SIZE = 50;
const RECLAIM_STALE_MINUTES = 30;
/** Reclaim must also run periodically: a crash after start() would otherwise
 * leave fredy-in-progress tickets wedged until the next process restart. */
const RECLAIM_EVERY_TICKS = 30;

/**
 * JQL reconcile loop: the fallback trigger that also catches webhook gaps.
 * setTimeout-chained (never setInterval) so a slow Jira call can never
 * overlap the next tick; errors are recorded and never kill the loop.
 */
export class JiraPoller {
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private lastRunAt: string | null = null;
  private lastError: string | null = null;
  private ticksSinceReclaim = 0;

  constructor(private readonly deps: JiraPollerDeps) {}

  get status(): { lastRunAt: string | null; lastError: string | null } {
    return { lastRunAt: this.lastRunAt, lastError: this.lastError };
  }

  async start(): Promise<void> {
    if (this.deps.intervalMs <= 0) {
      this.deps.logger.info("Poller disabled (JIRA_POLL_INTERVAL_MS=0)");
      return;
    }
    await this.reclaimStale();
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /**
   * A crash mid-run leaves a stuck fredy-in-progress label that the poll JQL
   * excludes forever; strip and re-enqueue anything stale at startup.
   */
  private async reclaimStale(): Promise<void> {
    const jql =
      `project = "${this.deps.projectKey}" AND labels = ${LABEL_IN_PROGRESS} ` +
      `AND updated <= -${RECLAIM_STALE_MINUTES}m`;
    try {
      const stale = await this.deps.client.searchIssues(jql, SEARCH_PAGE_SIZE);
      for (const issue of stale) {
        this.deps.logger.warn(`Reclaiming stale in-progress ticket ${issue.key}`);
        await this.deps.client.removeLabel(issue.key, LABEL_IN_PROGRESS);
        this.deps.queue.enqueue({ issueKey: issue.key, trigger: "reprocess" });
      }
    } catch (error) {
      this.deps.logger.error(
        { err: error },
        `Reclaim pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async tick(): Promise<void> {
    try {
      this.ticksSinceReclaim += 1;
      if (this.ticksSinceReclaim >= RECLAIM_EVERY_TICKS) {
        this.ticksSinceReclaim = 0;
        await this.reclaimStale();
      }
      const issues = await this.deps.client.searchIssues(this.deps.jql, SEARCH_PAGE_SIZE);
      for (const issue of issues) {
        this.deps.queue.enqueue({ issueKey: issue.key, trigger: "assigned" });
      }
      this.lastRunAt = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.deps.logger.error({ err: error }, `Poll failed: ${this.lastError}`);
    } finally {
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.deps.intervalMs);
    this.timer.unref();
  }
}
