import type { Logger } from "@fredy/agent-core";
import type { TicketSnapshot } from "../jira/types.js";
import type { TransitionIntent } from "../agent/types.js";

export interface HandlerDeps {
  readonly logger: Logger;
}

export interface HandlerResult {
  /** Markdown comment to post on the ticket. */
  readonly comment: string;
  readonly transitionIntent?: TransitionIntent;
  /** "reporter" hands the ticket back; undefined leaves the assignee alone. */
  readonly assignTo?: "reporter";
  readonly outcome: "resolved" | "needs-reporter";
}

/**
 * Deterministic responder for a recurring ticket type. matches() must be
 * pure and cheap (issue type / labels / regex — never an LLM call): handlers
 * run before cache and classification precisely to skip the LLM.
 */
export interface TicketHandler {
  readonly id: string;
  readonly description: string;
  matches(ticket: TicketSnapshot): boolean;
  handle(ticket: TicketSnapshot, deps: HandlerDeps): Promise<HandlerResult>;
}

/** First registered handler that matches wins — registration order matters. */
export class TicketHandlerRegistry {
  private readonly handlers = new Map<string, TicketHandler>();

  register(handler: TicketHandler): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Ticket handler already registered: ${handler.id}`);
    }
    this.handlers.set(handler.id, handler);
  }

  match(ticket: TicketSnapshot): TicketHandler | undefined {
    for (const handler of this.handlers.values()) {
      if (handler.matches(ticket)) return handler;
    }
    return undefined;
  }

  list(): TicketHandler[] {
    return [...this.handlers.values()];
  }
}
