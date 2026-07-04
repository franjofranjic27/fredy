import { isProbablyGerman } from "../language.js";
import type { TicketSnapshot } from "../jira/types.js";
import type { HandlerResult, TicketHandler } from "./handler.js";

const ACCESS_PATTERN = /\b(zugriff|berechtigung|access|permission)\b/i;
const SERVICE_REQUEST_PATTERN = /service request/i;

const CHECKLIST_DE = `Danke für deine Anfrage! Damit wir den Zugriff einrichten können, brauchen wir folgende Angaben:

- **Zielsystem**: Auf welches System oder Tool brauchst du Zugriff?
- **Benötigte Rolle/Berechtigung**: z.B. Lesen, Schreiben, Admin
- **Genehmigende Person**: Wer (Vorgesetzte:r oder System-Owner) genehmigt den Zugriff?
- **Zeitraum**: dauerhaft oder befristet (bis wann)?

Bitte ergänze die Angaben direkt hier im Ticket — wir übernehmen dann die Einrichtung.`;

const CHECKLIST_EN = `Thanks for your request! To set up the access we need the following details:

- **Target system**: Which system or tool do you need access to?
- **Required role/permission**: e.g. read, write, admin
- **Approver**: Who (manager or system owner) approves the access?
- **Duration**: permanent or time-limited (until when)?

Please add the details directly in this ticket — we will take care of the setup.`;

/**
 * v1 example handler: access/permission service requests always need the
 * same intake checklist, so no LLM round-trip is warranted.
 */
export function createAccessRequestHandler(): TicketHandler {
  return {
    id: "access-request",
    description: "Posts the standard intake checklist for access/permission service requests",
    matches(ticket: TicketSnapshot): boolean {
      return (
        SERVICE_REQUEST_PATTERN.test(ticket.issue.issueType) &&
        ACCESS_PATTERN.test(ticket.issue.summary)
      );
    },
    async handle(ticket: TicketSnapshot): Promise<HandlerResult> {
      const german = isProbablyGerman(`${ticket.issue.summary}\n${ticket.issue.description}`);
      return {
        comment: german ? CHECKLIST_DE : CHECKLIST_EN,
        transitionIntent: "waiting-for-reporter",
        assignTo: "reporter",
        outcome: "needs-reporter",
      };
    },
  };
}
