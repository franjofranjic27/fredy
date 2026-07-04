import type { TicketState } from "../state.js";
import { ESCALATION_TEMPLATE_DE, ESCALATION_TEMPLATE_EN } from "../prompts/clarification.js";

/** Deterministic template — an escalation must never depend on an LLM call. */
export function composeEscalationNode(state: TicketState): Partial<TicketState> {
  const template = state.language === "de" ? ESCALATION_TEMPLATE_DE : ESCALATION_TEMPLATE_EN;
  return { draftComment: template, outcome: "escalated" };
}
