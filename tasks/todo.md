# RAG-Forschungsplattform: Prototyp → evidenzbasiertes RAG → Agentic System

## Kontext

Ziel: Vom Prototyp zu einem RAG-System, bei dem jede Komponente (Chunking,
Embedding-Modell, Retrieval-Parameter, Reranking) austauschbar ist und
Verbesserungen durch Eval-Metriken (Precision/Recall/MRR/nDCG) belegt werden.

Entscheidungen:
- TS-Importer und TS-Eval werden durch Python-Projekte (uv, pytest, ruff, Sonar) ersetzt
- A/B-Experimente über "RAG-Profile": ein Profil = Chunking-Strategie + Parameter +
  Embedding-Modell → eigene Chunk-Tabelle (`chunks_<profil>`), da Vektordimension pro Tabelle fix ist
- Default-Profil schreibt weiter in `chunks` (Agent + Open-WebUI bleiben kompatibel)
- Bilder/Attachments: Metadaten + Binärdaten in `attachments`-Tabelle, optionales
  Caption-Embedding (Claude Vision → Text → bestehende Embedding-Pipeline)
- Reranking (Cohere/Voyage) mit Score-Thresholds im Eval-Harness, später im Agent
- LangGraph-Agent (Python) = Phase 3, nach Evidenz-Grundlage

## Phase 1: Python confluence-importer (ersetzt TS) — ✅ implementiert (197 Tests, 95 % Coverage)

- [x] uv-Projekt `services/confluence-importer` (Python 3.12+, src-Layout, ruff, pytest+cov)
- [x] Config via pydantic-settings (gleiche ENV-Variablen wie TS-Version)
- [x] Confluence-Client (Pages, Labels, CQL-Sync, Attachments/Bilder)
- [x] Chunking-Strategie-Registry: `html_section` (TS-Port, Testfälle 1:1), `fixed_size`, `recursive`
- [x] Embedding-Provider: openai, voyage, cohere (httpx, Protocol-basiert)
- [x] PgVector-Store mit Profil-Support (`rag_profiles`-Registry, Tabelle je Profil)
- [x] Attachment-Store + optionales Caption-Embedding (Claude Haiku Vision)
- [x] Pipeline: ingest, sync (inkl. neuer Lösch-Erkennung), Scheduler, lokale Dateien
- [x] CLI: `confluence-importer ingest|sync|profiles list|run`
- [x] Dockerfile (uv, multi-stage, non-root), docker-compose aktualisiert
- [x] Tests, coverage.xml für Sonar
- Offen: `.env.example` (Permission-gesperrt — manuell: MEDIA_ENABLED, MEDIA_CAPTION_ENABLED, MEDIA_MAX_BYTES, PROFILES_FILE); Docker-Image-Build nicht lokal verifiziert; OTEL-Tracing entfernt (TODO im README)

## Phase 2: Python eval (ersetzt TS) — ✅ implementiert (183 Tests, 97 % Coverage)

- [x] uv-Projekt `services/eval` (Paket `rag_eval`, CLI `rag-eval`)
- [x] Golden-Dataset-Format (JSONL, kompatibel zu bestehendem: queryId, query, relevantChunkIds)
- [x] Dataset-Generator (seeded Sampling → Claude generiert Fragen) — Port des TS-Generators
- [x] Metriken: precision@k, recall@k, MRR, nDCG@k, hit-rate (TS-Testfälle 1:1 portiert)
- [x] Reranker-Protocol: Cohere Rerank + Voyage Rerank, Score-Threshold konfigurierbar
- [x] Eval-Runner: Profil → embed → search → (rerank) → Metriken → Report (pre-/post-rerank)
- [x] A/B-Vergleich: `rag-eval compare` mit Vergleichstabelle und Winner-Markierung
- [x] Tests + coverage.xml
- Anmerkung: `--verify-neighbours` (LLM-Nachbar-Verifikation) nicht portiert; bei Bedarf nachrüsten

## Phase 3: CI/CD & Qualität

- [x] ci.yml: Python-Matrix-Job (uv, ruff, pytest+cov) für importer + eval; TS-Job für Agent behalten
- [x] sonar.yml erzeugt coverage.xml beider Python-Services; sonar-project.properties auf Python erweitert
- [x] lefthook-Hooks auf uv umgestellt, pnpm-lock bereinigt, release.yml-Filter korrigiert, renovate pep621
- [x] Code-Review (code-reviewer) + Security-Check (security-advisor) — alle Findings behoben

## Phase 4: LangGraph-Agent (TypeScript, User-Entscheidung 2026-07-03)

Entscheidungen: Agent bleibt TypeScript; schlanker Neubau **ohne NestJS** (Fastify);
LangChain-ChatModels ersetzen die eigene Provider-Registry; MCP-Entrypoint entfällt
vorerst; Session-Memory entfällt (Open-WebUI schickt Historie mit); Reranking mit
Threshold kommt in den Retrieval-Node (konsistent zur Eval-Konfiguration).

- [x] Porting-Dossier des NestJS-Agents (Contract, Auth, RBAC, Prompts, ENV) — inkl. Altlasten-Liste
      (packages/common tot, usage nie zurückgegeben, fetch_url ohne SSRF-Schutz, Sampling-Params ignoriert)
- [x] `packages/agent-core`: gemeinsame Base — pino-Logging, OTEL-Setup + GenAI-Semconv,
      LangChain-OTEL-Callback, ChatModel-Factory, Tool-Registry + RBAC-Filter, Agent-Registry,
      zod-Config (59 Tests, 96 % Coverage); `packages/common` gelöscht
- [x] `services/agent` Neubau: Fastify, OpenAI-kompatibler Endpoint (SSE via reply.hijack),
      Keycloak-JWT + API-Key-Auth, Rate-Limit mit Eviction, RBAC (172 Tests, 95 % Coverage)
- [x] RAG-Agent als LangGraph StateGraph: retrieve → (generate | refuse), Reranking
      (Cohere/Voyage, Top-N + Threshold), RAG-Profil aus `rag_profiles` mit env-Fallback
- [x] Tools portiert: vector_search, get_knowledge_base_stats, fetch_url (SSRF-gehärtet,
      1-MiB-Cap, Redirect-Revalidierung)
- [x] Dockerfile (agent-core statt common), docker-compose, README; Smoke-Test bestanden
- [x] CI/Sonar-Umbau (agent-core statt common, vitest-lcov); Typecheck-Fehler in
      langchain-callback.spec.ts gefixt (ChatGeneration-Fixtures)
- [x] Reviews durch: code-reviewer (kein Critical, 1 Major pg-Pool) + security-advisor
      (C1 x-role-Bypass, C2 offen ohne Auth, H1 XFF-Spoofing) — Fixes laufen
- [x] Findings-Fixes verifiziert (agent-core 63 Tests, agent 202 Tests, ~95 % Coverage, alles grün)
- [ ] Commits + PR

### Security-Findings (alle behoben)
- C1: bei aktivem Keycloak wird Rolle nur aus JWT abgeleitet, Header ignoriert (rbac.ts:27)
- C2: Fail-Fast ohne Auth, AGENT_ALLOW_ANONYMOUS Opt-in, Port 8001 nicht mehr published (config.ts:174)
- H1: TRUST_PROXY (default false), Rate-Limit-Keying auf request.ip
- M1: KEYCLOAK_ISSUER erzwungen bei gesetztem JWKS_URL (config.ts:169)
- L1/L2/L4: timingSafeEqual, pino-redact, jwtVerify algorithms RS256
- fetch_url: Request-Timeout, Scheme-Revalidierung pro Redirect
- Code: pg-Pool error-Listener, endOpenSpans-Cleanup bei Disconnect, Trace-Parenting im Stream,
  rerank-Filter statt non-null-assertion, toter otel-Config-Block entfernt, rag-agent.spec ergänzt

### Bewusst offen gelassen (Design-Entscheidung des Users)
- M3(sec): Prompt-Injection-Fencing des Retrieval-Kontexts — separat zu entscheiden
- Manuell (dotfiles gesperrt): services/agent/.env.example (neu: RAG_PROFILE, RERANKER, RERANK_*,
  AGENT_ALLOW_ANONYMOUS, TRUST_PROXY, FETCH_URL_TIMEOUT_MS; weg: SESSION_TTL_MS)
- Kontrakt-Abweichungen (dokumentiert): Zero-Hit-Retrieval → Refusal statt LLM-Antwort auf
  "No relevant documents found."; Rerank ohne Treffer über Threshold → Refusal
- Manuell: services/agent/.env.example aktualisieren (neu: RAG_PROFILE, RERANKER, RERANK_*;
  weg: SESSION_TTL_MS) — dotfiles sind für Claude gesperrt

## Review (2026-07-03)

**Endstand:** Importer 228 Tests / 95 % Coverage, Eval 198 Tests / 97 % Coverage, ruff clean.

**Code-Review-Findings (alle behoben):**
- Critical: Docker-Image startete nicht (editable install ohne `src/` im Runtime-Stage) → `--no-editable`
- Major: Sync löschte Chunks aus nicht mehr konfigurierten Spaces → Lösch-Erkennung pro Space gescopet
- Minor: Pagination bei modified pages; transaktionales `replace_page_chunks` (delete+insert atomar,
  auch in local_files); Byte-Cap auf tatsächlicher Downloadgröße (Streaming-Abbruch); Sampler toleriert
  NULL space_key/title; httpx-Clients werden deterministisch geschlossen (inkl. Async-Generator-Client);
  sync registriert Profil; Dimension-Validierung aller Embedding-Provider + Voyage index-Sortierung

**Security-Review:** keine Critical/High. Behoben: `data/` gitignored (Golden-Set = internes KB-Wissen),
Image-Allowlist (jpeg/png/gif/webp) vor Download, Byte-Cap. Bewusst offen (Hardening, dokumentiert):
Digest-Pinning der Base-Images, `http://`-Warnung für Base-URL, `embedding_api_key_env`-Restriktion.

**Manuell zu erledigen (Permission-gesperrt für Claude):** `.env.example` ergänzen um
`MEDIA_ENABLED=false`, `MEDIA_CAPTION_ENABLED=false`, `MEDIA_MAX_BYTES=5000000`, `PROFILES_FILE=`.

**Nicht verifiziert:** Docker-Image-Build (nur statisch geprüft), echter Sonar-Scan der Python-Coverage,
GitHub-Actions-Läufe (YAML lokal validiert).
