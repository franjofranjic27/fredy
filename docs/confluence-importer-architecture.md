# Confluence Importer — Architektur

## Datenquellen

- **Confluence** — REST API, Basic Auth (user + API Token)
- **Local Files** — gemountetes Verzeichnis (/data/files), Formate: .md, .txt, .html

---

## Modus 1: Full Ingestion (einmalig / beim Start)

1. **Confluence Client**
   - GET /rest/api/content?spaceKey=&type=page
   - Paginiert: 50 Pages pro Request (async generator)
   - Felder: body.storage (HTML), version, ancestors, labels, space

2. **Label Filter**
   - Seiten mit exclude-Labels (z.B. "draft", "archived") werden übersprungen
   - Optional: nur Seiten mit bestimmten include-Labels verarbeiten

3. **HTML Chunker**
   - HTML parsen (node-html-parser)
   - Split nach Headers (h1–h6) → Sections
   - Große Sections weiter nach Paragraphen splitten
   - Token-Overlap zwischen Chunks (Kontext-Kontinuität)
   - Kontext-Prefix pro Chunk: "Page: <title> / Path: <ancestors> / Section: <headers>"

4. **Embedding API** (Provider-agnostisch: OpenAI / Voyage AI / Cohere)
   - Input: Array von Chunk-Texten (Batch à 10)
   - Output: number[][] (Float-Vektoren)

5. **PostgreSQL / pgvector** (Tabelle `chunks`)
   - Alte Chunks der Seite löschen (`DELETE FROM chunks WHERE page_id = $1`)
   - Neue Chunks + Vektoren upserten (Batch à 100 Rows, `INSERT ... ON CONFLICT (chunk_id) DO UPDATE`)
   - Row: { chunk_id, page_id, space_key, title, url, content, labels (text[]), metadata (jsonb), embedding (vector) }

---

## Modus 2: Local Files Ingestion (parallel zu Confluence)

1. **LocalFileClient** — Verzeichnis scannen nach konfigurierten Extensions
2. Datei-Inhalt → HTML konvertieren (Markdown/Text → HTML)
3. **HTML Chunker** → **Embedding API** → **PostgreSQL / pgvector**
   (identischer Pfad wie Confluence ab Schritt 3)

---

## Modus 3: Incremental Sync (Daemon / CronJob)

1. **CronJob** (node-cron, default: alle 6 Stunden)
   - Lock verhindert parallele Sync-Runs

2. **Confluence CQL Query** — nur geänderte Seiten
   - GET /rest/api/content/search?cql=lastModified >= "<lastSyncTime>"

3. **Label Filter**
   - Seite excluded → Chunks aus der `chunks`-Tabelle löschen
   - Seite included → Re-Chunk → Re-Embed → Upsert in die `chunks`-Tabelle

4. **lastSyncTime** wird nach jedem erfolgreichen Run aktualisiert

---

## Query / Retrieval (Agent sucht im Index)

1. Agent sendet Suchanfrage (natürlichsprachlicher Text)
2. **Embedding API** — Anfrage → Vektor
3. **pgvector Similarity Search** (SQL auf Tabelle `chunks`)
   - Cosine Distance über den `<=>`-Operator; `score = 1 - distance`
   - Score Threshold: 0.7 (`WHERE 1 - (embedding <=> $1) >= 0.7`)
   - Optionale Filter: `space_key`, `labels` (`WHERE space_key = $2`, `labels && $3`)
   - Limit: Top 5 Ergebnisse (`ORDER BY embedding <=> $1 LIMIT 5`)
4. Rückgabe: [{ content, metadata (title, url, spaceKey, ...), score }]
5. **LLM / Agent** nutzt Chunks als Kontext für die Antwort

---

## Komponenten-Übersicht

| Komponente       | Technologie              | Aufgabe                              |
|------------------|--------------------------|--------------------------------------|
| Scheduler        | node-cron                | Periodischer Sync-Trigger            |
| ConfluenceClient | Fetch API + Basic Auth   | Seiten abrufen via REST/CQL          |
| LocalFileClient  | Node.js fs               | Lokale Dateien einlesen              |
| HTML Chunker     | node-html-parser         | HTML → semantische Text-Chunks       |
| Tokenizer        | tiktoken                 | Token-Counting für Chunk-Größen      |
| EmbeddingClient  | OpenAI / Voyage / Cohere | Text → Float-Vektoren                |
| PgVectorClient   | node-postgres (pg) + pgvector | Vektoren speichern und durchsuchen |
| Tracing          | OpenTelemetry            | Spans für ingest und sync            |

---

## Schlüssel-Parameter

| Parameter                    | Default / Wert            |
|------------------------------|---------------------------|
| Confluence Pages pro Request | 50                        |
| Chunk Batch (Embedding)      | 10 Chunks                 |
| Upsert Batch (pgvector)      | 100 Rows                  |
| Cron Schedule                | 0 */6 * * * (alle 6h)    |
| Similarity                   | Cosine                    |
| Score Threshold              | 0.7                       |
| Default Sync Window          | letzte 24h                |