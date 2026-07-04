# RAG-Evaluation & offene Architektur-Punkte — Anleitung

Diese Anleitung deckt die Punkte aus dem Senior-AI-Engineer-Review ab, die
**nicht** rein im Agent-Code lösbar sind: Sie brauchen Domänenwissen (Golden
Set), Änderungen am Importer (Hybrid-Suche, Profil-Schema) oder
organisatorische Entscheidungen (Dokument-Berechtigungen).

Reihenfolge ist bewusst: **Ohne Eval-Set ist jede weitere Optimierung
Bauchgefühl.** Erst messen, dann drehen.

---

## 1. Golden-Question-Set aufbauen (höchste Priorität)

### Was es ist

Ein versioniertes Set aus 30–50 realen Fragen mit bekannten richtigen
Antworten aus deinem Confluence-Bestand. Es ist die Grundlage für jede
objektive Aussage über Retrieval- und Antwortqualität.

### Schritt für Schritt

1. **Fragen sammeln.** Quellen, in dieser Reihenfolge:
   - Echte Nutzerfragen (sobald vorhanden: aus den `retrieval`-Log-Events —
     die Queries werden bereits geloggt).
   - Selbst formulierte Fragen beim Durchblättern der indexierten Seiten:
     pro wichtiger Confluence-Seite 1–2 Fragen, die diese Seite beantwortet.
   - Bewusst schwere Fälle (siehe Kategorien unten).

2. **Pro Frage die Ground Truth erfassen:** welche Chunks/Seiten die Antwort
   enthalten (URL reicht, Chunk-IDs sind besser) und die Kernaussagen der
   erwarteten Antwort in Stichpunkten.

3. **Kategorien abdecken** (jede Kategorie testet einen anderen Fehlermodus):

   | Kategorie | Beispiel | Testet |
   |---|---|---|
   | Faktisch | „Wie lautet der VPN-Hostname?" | Exakte Begriffe (Schwäche dichter Suche) |
   | Prozedural | „Wie richte ich X ein?" | Chunking/Kontextfenster |
   | Follow-up | „…und auf Cluster B?" (mit History) | Query-Rewriting |
   | Negativ | Frage, deren Antwort NICHT indexiert ist | Refusal statt Halluzination |
   | Mehrsprachig | Gleiche Frage auf Deutsch und Englisch | Embedding-Sprachrobustheit |
   | Synonym | Frage mit anderen Wörtern als die Doku | Semantisches Matching |

4. **Format:** JSONL, eine Zeile pro Frage, im Repo versionieren
   (z. B. `evals/golden-set.jsonl`):

   ```json
   {"id": "vpn-001", "category": "factual", "question": "Wie lautet der VPN-Hostname?", "history": [], "expected_urls": ["https://wiki/vpn"], "expected_points": ["vpn.example.com", "Cisco AnyConnect"], "answerable": true}
   {"id": "neg-001", "category": "negative", "question": "Wie beantrage ich Urlaub?", "history": [], "expected_urls": [], "expected_points": [], "answerable": false}
   ```

### Metriken

**Retrieval (billig, deterministisch, bei jeder Änderung laufen lassen):**
- **Recall@k**: Anteil der Fragen, bei denen mindestens ein erwarteter
  Chunk in den Top-k landet. Wichtigste Zahl überhaupt.
- **MRR** (Mean Reciprocal Rank): 1/Rang des ersten Treffers, gemittelt —
  misst, ob das Richtige auch *oben* steht (relevant fürs Token-Budget).

**Antwortqualität (LLM-as-judge, teurer, vor Releases):**
- **Faithfulness**: Judge-LLM prüft „Ist jede Aussage der Antwort durch den
  gelieferten Kontext gedeckt?" (Skala 1–5 oder pro Aussage ja/nein).
- **Answer Recall**: „Enthält die Antwort die `expected_points`?"
- **Refusal-Korrektheit**: Bei `answerable: false` muss die Refusal-Antwort
  kommen — das ist ein einfacher String-Match, kein Judge nötig.

### Harness

Ein kleines Skript reicht (Node oder Python), kein Framework nötig:

1. Golden Set laden.
2. Pro Frage `POST /v1/chat/completions` gegen den lokal laufenden Agent
   (bzw. für reine Retrieval-Metriken: direkt die `vector_search`-Logik).
3. Retrieval-Treffer aus den `retrieval`-Log-Events oder einem Debug-Feld
   ziehen, Metriken rechnen, als JSON/Markdown-Report ausgeben.
4. Report pro Lauf versionieren (Datum + Git-SHA + Konfiguration:
   Embedding-Modell, Threshold, top-k, Reranker an/aus).

Alternativ: RAGAS (Python) liefert Faithfulness/Context-Precision fertig —
lohnt sich, sobald der eigene Harness zu wachsen beginnt.

### Als CI-Gate

Sobald Baseline-Zahlen existieren: GitHub-Action, die bei Änderungen an
`services/agent` oder am Importer den Retrieval-Teil (ohne LLM-Judge, ohne
API-Kosten außer Embeddings) laufen lässt und bei Recall@k-Regression > X %
failt.

### Damit beantwortbare Fragen

- Ist `RAG_SCORE_THRESHOLD=0.7` richtig? → Threshold-Sweep (0.5–0.8) gegen
  Recall/Precision fahren.
- Bringt der Reranker etwas? → A/B mit `RERANKER=none` vs. `cohere`.
- Lohnt `RAG_QUERY_REWRITE=true`? → Follow-up-Kategorie vorher/nachher.
  **Das Flag ist implementiert, aber bewusst default-off — erst mit Evals
  einschalten.**

---

## 2. Score-Threshold ins RAG-Profil verschieben (Importer-Änderung)

**Problem:** Der Cosine-Threshold ist embedding-modell-abhängig. Die
`rag_profiles`-Tabelle wechselt das Modell pro Profil, aber
`RAG_SCORE_THRESHOLD` bleibt global — beim Profilwechsel filtert der
Threshold falsch.

**Umsetzung:**
1. Im Importer (Python): Spalte `score_threshold REAL NULL` zu
   `rag_profiles` hinzufügen; beim Anlegen eines Profils den kalibrierten
   Wert (aus dem Eval-Harness des Importers) mitschreiben.
2. Im Agent (`services/agent/src/profile.ts`): `score_threshold` mit
   selektieren; wenn gesetzt, überschreibt er `config.retrieval.scoreThreshold`
   im `ResolvedRagProfile`. Env bleibt Fallback.
3. Kalibrierung pro Modell: Threshold-Sweep gegen das Golden Set (siehe 1).

---

## 3. Hybrid-Suche (Vector + Volltext mit RRF)

**Warum:** IT-Ops-Fragen enthalten exakte Tokens (Hostnames, Fehlercodes,
Akronyme), bei denen Embeddings systematisch schwach sind. Postgres kann
beides in einer Query.

**Umsetzung (Importer + Agent):**
1. Importer: `tsvector`-Spalte auf die Chunk-Tabellen +
   GIN-Index. Für Deutsch/Englisch gemischt: `to_tsvector('simple', content)`
   ist der sichere Start (kein Stemming, dafür sprachneutral).
2. Agent (`pgvector.ts`): zweite Query `ts_rank` über
   `websearch_to_tsquery('simple', $query)`, dann **Reciprocal Rank Fusion**
   in TypeScript: `score(doc) = Σ 1/(60 + rank_i)` über beide Ranglisten,
   Top-k nach Fusion-Score.
3. Effekt mit dem Golden Set messen (Kategorie „Faktisch" sollte deutlich
   springen). Erst danach als Default aktivieren.

Hinweis: Ein `HNSW`-Index auf der Embedding-Spalte (`vector_cosine_ops`)
gehört ebenfalls in den Importer, falls noch nicht vorhanden — ab ~50k
Chunks sonst spürbare Latenz.

---

## 4. Dokument-Level-Autorisierung im Retrieval

**Problem:** RBAC filtert Tool-*Namen*; jede Rolle mit `vector_search` sieht
alle Chunks. Sobald Confluence-Spaces mit eingeschränkten Berechtigungen
indexiert werden, leakt der Agent sie.

**Entscheidung zuerst:** Welche Granularität brauchst du wirklich?
- **Space-Level** (meist ausreichend): Importer schreibt `space_key` schon
  mit. Mapping Rolle → erlaubte Spaces (z. B. via `ROLE_TOOL_CONFIG`-artiger
  Env oder eigener Tabelle). Agent: JWT-Rolle → Space-Liste → `spaceKey`-
  Filter (existiert bereits in `pgvector.ts`, wird nur nie befüllt) als
  `WHERE space_key = ANY($n)`.
- **Seiten-Level** (aufwendig): Confluence-Permissions pro Seite beim Import
  mitschreiben und pro Request gegen die Nutzeridentität prüfen. Nur bauen,
  wenn wirklich nötig.

**Solange nicht umgesetzt:** die Regel „nur öffentliche Spaces indexieren"
explizit dokumentieren (Importer-README + Betriebsdoku) — sie ist aktuell
ein unsichtbarer Vertrag.

---

## 5. Prompt-Caching (erst später relevant)

Anthropic cached nur Präfixe ab ~1024 Tokens (Sonnet). Der statische
`RAG_SYSTEM_PROMPT` ist weit darunter — Caching bringt **heute nichts**.
Relevant wird es, wenn: der System-Prompt deutlich wächst (Few-Shot-
Beispiele, Tool-Beschreibungen eines ReAct-Agents) oder derselbe Kontext
mehrfach pro Konversation gesendet wird. Dann: statischen Teil als eigenen
Content-Block mit `cache_control: {type: "ephemeral"}` markieren (nur beim
Anthropic-Provider) und den dynamischen Kontext dahinter.

---

## 6. Vor dem ersten schreibenden Tool (ReAct/MCP-Ausbau)

Kurz-Checkliste, bevor Tools mit Seiteneffekten dazukommen:

1. **Tool-Klassifizierung:** `readOnly: boolean` (oder ein `effects`-Enum)
   als Pflichtfeld an der Tool-Registrierung in `ToolRegistry`.
2. **Human-in-the-loop:** Schreibende Tool-Calls nicht autonom ausführen —
   Vorschlag an den Client zurückgeben, Bestätigung erforderlich.
3. **Prompt-Injection-Modell:** Retrieved Content ist untrusted Input.
   Regel: Inhalte aus Retrieval/Tool-Ergebnissen dürfen nie unmittelbar
   Tool-Calls mit Seiteneffekten auslösen (Confused-Deputy). Retrieval-
   Content strukturell vom Instruktionsteil trennen und im System-Prompt
   explizit als Daten deklarieren.
4. **OWASP LLM Top 10** einmal komplett gegen das Design halten (LLM01
   Prompt Injection, LLM02 Insecure Output Handling, LLM08 Excessive
   Agency sind für diesen Ausbau die relevanten).
