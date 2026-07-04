# AIOps-Agent — Architektur

Autonomer Observability-Agent für einen Kubernetes-/OpenShift-Cluster mit
Grafana, Prometheus und Loki. Der Agent beobachtet das System, erstellt
tägliche Health-Reports, beantwortet Ops-Fragen im Chat und triagiert
Incidents — zunächst rein lesend, später mit abgesicherten Aktionen.

---

## Grundidee

Der Agent sitzt zwischen **Signalebene** (Metriken, Logs, Alerts) und
**Aktionsebene** (Cluster, GitOps, Tickets, Chat). Er korreliert Signale,
zieht Wissen aus Runbooks (RAG) und liefert Diagnosen und Empfehlungen —
Aktionen nur abgestuft und abgesichert (siehe Autonomie-Stufen).

```
   EINGÄNGE (Trigger)              AGENT-KERN                     AUSGÄNGE
┌──────────────────────┐   ┌─────────────────────────┐   ┌───────────────────────┐
│ 1. Cron (täglich)    │──▶│                         │──▶│ Confluence Page       │
│                      │   │   Triage-/Analyse-Loop  │   │  (Daily Report)       │
│ 2. Slack Events API  │──▶│   (LLM + Tools)         │   │                       │
│    @ops-agent Mention│   │                         │──▶│ Slack Message         │
│    + Thread-Kontext  │   │   Tools (MCP):          │   │  (TL;DR + Link /      │
│                      │   │   • Prometheus (PromQL) │   │   Thread-Antwort)     │
│ 3. A2A-Endpoint      │──▶│   • Loki (LogQL)        │   │                       │
│    für jira-agent    │   │   • Grafana / Alerts    │──▶│ Jira-Kommentar        │
│    (Ticket-Triage)   │   │   • K8s read-only       │   │  (via jira-agent)     │
│                      │   │   • RAG (Runbooks)      │   └───────────────────────┘
│ 4. Alertmanager      │   │   • Report-Archiv       │
│    Webhook (später)  │   └─────────────────────────┘
└──────────────────────┘
```

**Ein Service, ein Kern:** Der Triage-/Analyse-Loop ist für alle Trigger
derselbe — nur Systemprompt, Eingabekontext und Output-Adapter
unterscheiden sich pro Eingang.

---

## Trigger-Pfade

1. **Proaktiv (Cron)** — täglicher Health-Check → Daily Report (Use Case 1)
2. **Interaktiv (Slack)** — `@ops-agent`-Mention mit Thread-Kontext → Fall-Triage im Thread (Use Case 2)
3. **Ticket-getrieben (A2A)** — jira-agent delegiert Ops-Tickets zur Triage (Use Case 3)
4. **Reaktiv (Alertmanager-Webhook)** — automatische Triage bei feuerndem Alert; strukturell identisch zu Pfad 3, kommt in einer späteren Ausbaustufe

---

## Use Case 1: Daily Report

„Was war in den letzten 24h los, was schlage ich vor, worauf muss man achten?"
→ strukturierter Report als Confluence-Page + Benachrichtigung (Slack oder E-Mail).

### Pipeline

1. **Sammeln (deterministisch)** — feste Query-Batterie, läuft jeden Tag identisch:
   - Alert-Historie der letzten 24h (Alertmanager/Grafana)
   - Error-Log-Raten pro Service (Loki)
   - Ressourcen-Trends: CPU/Memory nahe Limits, Restarts, OOMKills
   - Latenz-Perzentile der wichtigsten Services
   - Kubernetes-Events
   - Ergebnis: strukturiertes JSON-Faktenpaket
2. **Vertiefen (agentisch)** — nur bei Auffälligkeiten im Faktenpaket darf
   der Agent mit Tools nachbohren (z.B. „Error-Rate 4× gestiegen → Logs
   korrelieren")
3. **Synthese (LLM)** — Report nach festem Template:
   - Zusammenfassung
   - Vorfälle & Auffälligkeiten
   - Trends & Kapazität
   - Empfehlungen
   - Beobachtungspunkte
4. **Publizieren**
   - Neue Confluence-Page unter Parent „Daily Ops Reports", Datum im Titel
   - Slack/E-Mail: Link + die 3 wichtigsten Punkte — oder
     „✅ Heute sieht alles gut aus"

### Designentscheidungen

- **Datensammlung nicht dem LLM überlassen.** Die feste Query-Batterie macht
  Reports tagesübergreifend vergleichbar, nichts wird „vergessen", Kosten
  sind planbar. Agentische Freiheit nur im Vertiefungs-Schritt.
- **Gestriger Report als Kontext.** Der Agent liest den Vortagesreport und
  kann Trends fortschreiben („Memory-Trend bei Service X gestern schon
  erwähnt, weiter steigend — jetzt handeln"). Das Report-Archiv
  (Confluence und/oder pgvector) ist das Gedächtnis des Agenten.

---

## Use Case 2: Slack-Chat

`@ops-agent was denkst du, wie könnte man Problem xyz lösen?`

- **Slack-App** mit Events API (`app_mention`) + Bot-Token
- **3-Sekunden-Regel:** Slack verlangt Ack innerhalb von 3s → Event sofort
  quittieren (👀-Reaction oder „schaue ich mir an…"), Triage asynchron,
  Antwort in den Thread posten
- **Thread-Kontext:** bei Mention im Thread den Verlauf per
  `conversations.replies` holen und als Fallkontext mitgeben
- **Konversationsgedächtnis** über die Thread-ID: Follow-up-Fragen im selben
  Thread setzen die Session fort
- Der Agent läuft seinen normalen Triage-Loop (Metriken, Logs, Runbook-RAG)
  und antwortet mit Diagnose + Lösungsvorschlag

Slack ist ein **UI, kein Agent** — hier braucht es kein A2A, der
Slack-Handler ruft den Triage-Kern direkt auf.

---

## Use Case 3: Triage über jira-agent (A2A)

Der jira-agent erkennt Ops-Tickets und delegiert die Triage an den
aiops-agent über das **A2A-Protokoll** (Agent2Agent, Linux Foundation,
v1.0 seit April 2026).

```
Jira-Ticket ─▶ jira-agent (A2A-Client)
                  │  erkennt Ops-Ticket
                  │  message/send: Ticket-Kontext als Task
                  ▼
              aiops-agent (A2A-Server, Agent Card: skill "triage-incident")
                  │  working:  Tools via MCP (Prometheus, Loki, RAG)
                  │  ── SSE-Updates ──▶ jira-agent postet Zwischenstand ins Ticket
                  │  input-required? ─▶ jira-agent fragt Reporter, reicht Antwort zurück
                  ▼
              completed: Artifact = strukturierte Diagnose
                  │
                  ▼
              jira-agent postet Diagnose als Ticket-Kommentar
```

### Warum A2A statt einfachem REST-Endpoint

| A2A-Feature | Nutzen hier |
|---|---|
| Task-Lifecycle (`submitted → working → completed/failed`) | Triage kann Minuten dauern — kein selbstgebautes Polling/Callback nötig |
| Streaming (SSE) / Push-Notifications | Zwischenstände („prüfe Logs von Service X…") als Ticket-Updates |
| `input-required` | Agent kann zurückfragen („welcher Namespace?") — passt zum bestehenden jira-agent-Pattern „Reporter fragen statt raten" |
| Agent Card (`/.well-known/agent-card.json`) | Skills, Auth, Endpoints discoverbar — keine hart verdrahteten Schnittstellen, erweiterbar für künftige Agenten |
| Opazität | Agenten teilen Tasks und Artifacts, nicht Interna — verstärkt die lose Kopplung im Monorepo |

**Einordnung:** Für zwei Services von einer Person wäre A2A objektiv
Overkill — aber Fredy ist Lern- und Portfolio-Plattform, und A2A ist neben
MCP der zweite relevante Standard im Agenten-Umfeld. Langläufer-Tasks und
der Rückfragen-Flow sind zudem echte (nicht nur akademische) A2A-Anwendungsfälle.

**Austauschbarkeit:** Triage-Kern als eigenes Modul, A2A als dünner Adapter
davor (offizielles a2aproject JS SDK). Ein REST-Adapter kann jederzeit
daneben gestellt werden, ohne den Kern anzufassen.

### Rollenverteilung

- Der **jira-agent bleibt Besitzer der Jira-Interaktion** — der aiops-agent
  schreibt nie direkt in Jira
- **MCP vs. A2A:** MCP ist Agent↔Tool (aiops-agent → Prometheus/Loki/
  Grafana), A2A ist Agent↔Agent (jira-agent → aiops-agent). Die beiden
  ergänzen sich, ersetzen sich nicht.

---

## Tool-Anbindung (MCP)

| Signal | Anbindung |
|---|---|
| Metriken (PromQL) | Prometheus MCP oder Grafana MCP |
| Logs (LogQL) | Grafana MCP (deckt Loki, Prometheus, Dashboards, Alerts in einem ab) |
| Cluster-State | Kubernetes/OpenShift MCP, **read-only**, dedizierter ServiceAccount |
| Runbooks / Betriebsdoku | bestehende Fredy-RAG-Pipeline (pgvector + confluence-importer) |
| Report-Archiv | Confluence (Vortagesreport) und/oder pgvector |

Das RAG ist der Unterschied zwischen „generischer LLM rät" und „Agent kennt
unsere Betriebsdoku" — Runbooks, Postmortems und Architekturdoku fließen in
jede Triage ein. Postmortem-Entwürfe des Agenten füttern wiederum das RAG
(Feedback-Loop).

---

## Autonomie-Stufen (Roadmap für Aktionen)

Vertrauen entsteht oder stirbt an den Aktionen. Drei Stufen:

1. **Read-only (Start, sofort autonom)** — Diagnose, Korrelation, Reports,
   Ticket-Kommentare, Dashboard-Annotations. Kein Risiko, sofortiger Nutzen.
   *Alle drei Use Cases oben sind Stufe 1.*
2. **Human-in-the-loop** — Agent schlägt konkrete Aktion vor („Memory-Limit
   von 512Mi auf 1Gi"), Mensch approved per Slack-Button oder PR-Review.
   **Wichtig auf OpenShift:** Aktionen als **Pull Request ins GitOps-Repo**
   statt direktem `oc patch` — sonst überschreibt ArgoCD die Änderung beim
   nächsten Sync, und Audit-Trail + Review gehen verloren.
3. **Autonom mit Allowlist** — nur eng definierte, reversible Aktionen
   (Restart bekannter Deployments, Scale innerhalb definierter Grenzen), mit
   automatischem **Verify-Schritt** (Metriken erneut prüfen: hat es
   geholfen?) und Rollback-Pfad.

---

## Guardrails & Betrieb

- **RBAC:** dedizierter ServiceAccount, minimale Rechte (nur benötigte
  Verbs/Namespaces), Namespace-Scoping
- **Action-Allowlist** ab Stufe 2/3 — keine freien Cluster-Mutationen
- **Query-Budgets:** Limits für Anzahl/Umfang der PromQL-/LogQL-Queries pro
  Lauf (Kosten- und Lastkontrolle)
- **Audit-Log:** jede Tool-Ausführung wird protokolliert (wer/was/warum/Ergebnis)
- **Verify nach jeder Aktion:** Wirkung anhand der Metriken prüfen, sonst
  eskalieren statt weiterprobieren

---

## Einordnung im Monorepo

- Neuer Service: `services/aiops-agent` — strukturell ein Geschwister des
  `jira-agent` (anderer Trigger, andere Tools, gleicher Agent-Kern-Ansatz)
- Wiederverwendung: RAG-Pipeline, pgvector, LLM-Provider-Abstraktion
- Lose Kopplung (A2A statt Shared Code zwischen den Agenten) hält das
  spätere Repository-Splitting offen

---

## Baureihenfolge

1. **Triage-Kern + Tools** — MCP-Anbindung Prometheus/Loki/Grafana +
   K8s read-only; als eigenständiger Service testbar, ohne Integrationen
2. **Daily Report** — Cron + Confluence-Publisher + Slack/E-Mail-Notification;
   höchster sichtbarer Nutzen, kein Interaktions-Overhead
3. **Slack-Chat** — Slack-App-Setup, Async-Handling, Thread-Kontext
4. **A2A-Anbindung jira-agent** — dünner Adapter über dem Triage-Kern
5. *(später)* Alertmanager-Webhook (reaktive Triage), dann Autonomie-Stufe 2
   (GitOps-PRs mit Approval)

---

## Offene Punkte / Entscheidungen

- **Observability-Backend zum Testen:** lokal kind-Cluster +
  kube-prometheus-stack (gratis, unbegrenzt, OOM-Szenarien provozierbar);
  Dynatrace-Trial (15 Tage) nur als optionaler Exkurs für Davis-AI-Signale
- **Grafana MCP vs. separate Prometheus/Loki MCPs:** Grafana MCP als
  Einstieg (ein Server, deckt alles ab), bei Bedarf später aufteilen
- **E-Mail vs. Slack** für die Report-Notification: beides als Adapter
  vorsehen, Slack zuerst umsetzen
- **Report-Retention:** wie lange Daily Reports in Confluence behalten /
  ob ältere Reports zusammengefasst werden
