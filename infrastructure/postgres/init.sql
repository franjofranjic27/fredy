-- Fredy PostgreSQL/pgvector bootstrap.
-- Runs once on first container start via /docker-entrypoint-initdb.d.
-- The confluence-importer also (re)creates this schema idempotently at startup,
-- so this file is primarily to guarantee the extension exists for both the
-- Fredy RAG tables and Open-WebUI's own pgvector tables in the same database.

CREATE EXTENSION IF NOT EXISTS vector;

-- Fredy RAG chunks (mirrors the former Qdrant "confluence-pages" collection).
-- chunk_id is the natural primary key, replacing Qdrant's hashed integer point id.
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id   TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL,
  space_key  TEXT,
  title      TEXT,
  url        TEXT,
  content    TEXT NOT NULL,
  labels     TEXT[] NOT NULL DEFAULT '{}',
  metadata   JSONB NOT NULL DEFAULT '{}',
  embedding  VECTOR(1536) NOT NULL
);

-- ANN index for cosine similarity search (matches Qdrant's Cosine distance).
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops);

-- Metadata filter indexes (replace Qdrant payload indexes).
CREATE INDEX IF NOT EXISTS chunks_space_key_idx ON chunks (space_key);
CREATE INDEX IF NOT EXISTS chunks_page_id_idx   ON chunks (page_id);
CREATE INDEX IF NOT EXISTS chunks_labels_idx    ON chunks USING gin (labels);
