# Fredy Jira Agent

Autonomous worker that triages Jira Cloud tickets assigned to a dedicated
agent account. It reads the ticket, decides between answering from the
knowledge base, asking the reporter for missing details, running a
deterministic handler, or escalating to a human — and acts through
Jira-internal operations only (comment, assign, transition).

## How it gets work

- **Polling (default):** a JQL reconcile loop finds tickets assigned to the
  agent account that no agent label has touched yet (`JIRA_POLL_INTERVAL_MS`,
  `0` disables it). Assignment can be automated with a Jira Automation rule
  ("issue created → assign to agent account").
- **Webhook (optional):** `POST /webhooks/jira` reacts immediately to
  issue-created/updated events. It is disabled unless `JIRA_WEBHOOK_SECRET`
  is set, and requires a publicly reachable endpoint (cloudflared/ngrok
  tunnel or a cloud deployment) — locally the poller does all the work.

  Setup in Jira Cloud (Settings → System → WebHooks): URL
  `https://<public-host>/webhooks/jira`, secret = `JIRA_WEBHOOK_SECRET`,
  events "Issue created" and "Issue updated", optionally scoped with the
  same JQL as the poller. Requests are authenticated via the
  `x-hub-signature` HMAC-SHA256 header over the raw body; invalid
  signatures get 401, and the endpoint always acks valid requests with
  204 immediately — processing happens in the background queue.

## Label protocol (idempotency)

The agent claims and releases tickets via labels, visible on the board:

| Label | Meaning |
| --- | --- |
| `fredy-in-progress` | claimed, currently being processed |
| `fredy-done` | processed successfully |
| `fredy-failed` | processing failed, needs a human look |

Stuck `fredy-in-progress` tickets (crash mid-run, older than 30 min) are
reclaimed at poller startup.

## Configuration

All variables live in the root `.env.example`. Required: `JIRA_BASE_URL`,
`JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_AGENT_ACCOUNT_ID`.

## Development

```bash
pnpm install
pnpm build && pnpm start   # reads ../../.env
pnpm test
```
