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

## Phase 4 (nächste Session): LangGraph-Agent

- [ ] Neuer Python-Agent mit LangGraph, FastAPI, OpenAI-kompatibler Endpoint
- [ ] Retrieval-Tool mit Profil + Reranking + Thresholds (Erkenntnisse aus Eval)
- [ ] Ablösung des NestJS-Agents nach Feature-Parität

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
