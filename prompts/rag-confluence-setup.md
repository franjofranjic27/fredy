# RAG System: Confluence to Vector Database

This guide provides step-by-step instructions for building a RAG (Retrieval-Augmented Generation) system that loads Confluence pages into a Qdrant vector database for use with the Fredy agent.

## Overview

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Confluence    │────▶│  RAG Pipeline   │────▶│     Qdrant      │
│   (Source)      │     │  (Ingestion)    │     │  (Vector DB)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │ Embedding API   │
                        │ (OpenAI/Voyage) │
                        └─────────────────┘
```

### Components

1. **Confluence Connector**: Fetches pages from Confluence REST API
2. **Embedding Client**: Provider-agnostic client for generating embeddings
3. **Chunking Pipeline**: Splits pages into semantic chunks with metadata
4. **Qdrant Client**: Stores and retrieves vectors
5. **Sync Scheduler**: Periodic updates via cron

### Features

- Label-based filtering (include/exclude pages by label)
- Metadata preservation (space, labels, hierarchy, author, timestamps)
- Hybrid chunking (header-based with fallback splitting)
- Provider-agnostic embedding (OpenAI, Voyage AI, Cohere)
- Incremental sync with change detection

---

## Phase 1: Qdrant Setup and Embedding Client

### 1.1 Verify Qdrant is Running

Qdrant should already be in your docker-compose.yml. Verify it's accessible:

```bash
curl http://localhost:6333/healthz
```

### 1.2 Project Structure

Create the RAG service structure:

```
services/rag/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI entry point
│   ├── config.ts             # Configuration management
│   ├── embeddings/
│   │   ├── types.ts          # Embedding client interface
│   │   ├── openai.ts         # OpenAI implementation
│   │   ├── voyage.ts         # Voyage AI implementation
│   │   └── index.ts          # Factory function
│   ├── confluence/
│   │   ├── types.ts          # Confluence types
│   │   ├── client.ts         # Confluence API client
│   │   └── index.ts
│   ├── chunking/
│   │   ├── types.ts          # Chunk types
│   │   ├── html-chunker.ts   # HTML/Confluence chunking
│   │   └── index.ts
│   ├── qdrant/
│   │   ├── client.ts         # Qdrant operations
│   │   └── index.ts
│   ├── pipeline/
│   │   ├── ingest.ts         # Ingestion pipeline
│   │   ├── sync.ts           # Sync logic
│   │   └── index.ts
│   └── scheduler/
│       └── cron.ts           # Scheduled sync
```

### 1.3 Package Dependencies

**package.json:**

```json
{
  "name": "@fredy/rag",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "ingest": "tsx src/index.ts ingest",
    "sync": "tsx src/index.ts sync",
    "search": "tsx src/index.ts search"
  },
  "dependencies": {
    "@qdrant/js-client-rest": "^1.9.0",
    "node-cron": "^3.0.3",
    "node-html-parser": "^6.1.13",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/node-cron": "^3.0.11",
    "tsx": "^4.15.0",
    "typescript": "^5.4.5"
  }
}
```

### 1.4 Configuration

**src/config.ts:**

```typescript
import { z } from "zod";

const ConfigSchema = z.object({
  // Confluence settings
  confluence: z.object({
    baseUrl: z.string().url(),
    username: z.string(),
    apiToken: z.string(),
    spaces: z.array(z.string()).min(1),
    includeLabels: z.array(z.string()).optional(),
    excludeLabels: z.array(z.string()).default(["ignore", "draft", "archived"]),
  }),

  // Embedding settings
  embedding: z.object({
    provider: z.enum(["openai", "voyage", "cohere"]),
    apiKey: z.string(),
    model: z.string(),
    dimensions: z.number().default(1536),
  }),

  // Qdrant settings
  qdrant: z.object({
    url: z.string().default("http://localhost:6333"),
    collectionName: z.string().default("confluence-pages"),
    apiKey: z.string().optional(),
  }),

  // Chunking settings
  chunking: z.object({
    maxTokens: z.number().default(800),
    overlapTokens: z.number().default(100),
    preserveCodeBlocks: z.boolean().default(true),
    preserveTables: z.boolean().default(true),
  }),

  // Sync settings
  sync: z.object({
    cronSchedule: z.string().default("0 */6 * * *"), // Every 6 hours
    fullSyncOnStart: z.boolean().default(false),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    confluence: {
      baseUrl: process.env.CONFLUENCE_BASE_URL,
      username: process.env.CONFLUENCE_USERNAME,
      apiToken: process.env.CONFLUENCE_API_TOKEN,
      spaces: process.env.CONFLUENCE_SPACES?.split(",") ?? [],
      includeLabels: process.env.CONFLUENCE_INCLUDE_LABELS?.split(","),
      excludeLabels: process.env.CONFLUENCE_EXCLUDE_LABELS?.split(",") ?? [
        "ignore",
        "draft",
        "archived",
      ],
    },
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER as "openai" | "voyage" | "cohere",
      apiKey: process.env.EMBEDDING_API_KEY,
      model: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1536"),
    },
    qdrant: {
      url: process.env.QDRANT_URL ?? "http://localhost:6333",
      collectionName: process.env.QDRANT_COLLECTION ?? "confluence-pages",
      apiKey: process.env.QDRANT_API_KEY,
    },
    chunking: {
      maxTokens: parseInt(process.env.CHUNK_MAX_TOKENS ?? "800"),
      overlapTokens: parseInt(process.env.CHUNK_OVERLAP_TOKENS ?? "100"),
      preserveCodeBlocks: process.env.CHUNK_PRESERVE_CODE !== "false",
      preserveTables: process.env.CHUNK_PRESERVE_TABLES !== "false",
    },
    sync: {
      cronSchedule: process.env.SYNC_CRON ?? "0 */6 * * *",
      fullSyncOnStart: process.env.SYNC_FULL_ON_START === "true",
    },
  });
}
```

### 1.5 Embedding Client Interface

**src/embeddings/types.ts:**

```typescript
export interface EmbeddingClient {
  /**
   * Generate embeddings for a batch of texts
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Generate embedding for a single text
   */
  embedSingle(text: string): Promise<number[]>;

  /**
   * Get the dimension of embeddings produced by this client
   */
  readonly dimensions: number;

  /**
   * Get the model name
   */
  readonly model: string;
}

export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  dimensions?: number;
}
```

### 1.6 OpenAI Embedding Implementation

**src/embeddings/openai.ts:**

```typescript
import type { EmbeddingClient, EmbeddingConfig } from "./types.js";

export class OpenAIEmbedding implements EmbeddingClient {
  private apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private baseUrl = "https://api.openai.com/v1";

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.dimensions = config.dimensions ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => item.embedding);
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }
}
```

### 1.7 Voyage AI Embedding Implementation

**src/embeddings/voyage.ts:**

```typescript
import type { EmbeddingClient, EmbeddingConfig } from "./types.js";

export class VoyageEmbedding implements EmbeddingClient {
  private apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  private baseUrl = "https://api.voyageai.com/v1";

  constructor(config: EmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || "voyage-2";
    this.dimensions = config.dimensions ?? 1024;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        input_type: "document",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Voyage embedding failed: ${error}`);
    }

    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }
}
```

### 1.8 Embedding Factory

**src/embeddings/index.ts:**

```typescript
import type { EmbeddingClient } from "./types.js";
import { OpenAIEmbedding } from "./openai.js";
import { VoyageEmbedding } from "./voyage.js";

export type { EmbeddingClient } from "./types.js";

export interface CreateEmbeddingClientOptions {
  provider: "openai" | "voyage" | "cohere";
  apiKey: string;
  model: string;
  dimensions?: number;
}

export function createEmbeddingClient(
  options: CreateEmbeddingClientOptions
): EmbeddingClient {
  switch (options.provider) {
    case "openai":
      return new OpenAIEmbedding({
        apiKey: options.apiKey,
        model: options.model,
        dimensions: options.dimensions,
      });

    case "voyage":
      return new VoyageEmbedding({
        apiKey: options.apiKey,
        model: options.model,
        dimensions: options.dimensions,
      });

    case "cohere":
      // TODO: Implement Cohere client
      throw new Error("Cohere embedding not yet implemented");

    default:
      throw new Error(`Unknown embedding provider: ${options.provider}`);
  }
}
```

---

## Phase 2: Confluence Connector

### 2.1 Setting Up Confluence API Access

#### For Atlassian Cloud:

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click "Create API token"
3. Give it a name (e.g., "Fredy RAG")
4. Copy the token immediately (it won't be shown again)
5. Your username is your email address
6. Base URL format: `https://your-domain.atlassian.net/wiki`

#### For Self-Hosted (Data Center/Server):

1. Go to your profile settings
2. Create a Personal Access Token
3. Base URL format: `https://confluence.your-company.com`

### 2.2 Confluence Types

**src/confluence/types.ts:**

```typescript
export interface ConfluencePage {
  id: string;
  type: string;
  status: string;
  title: string;
  space: {
    key: string;
    name: string;
  };
  body: {
    storage: {
      value: string;
      representation: string;
    };
  };
  version: {
    number: number;
    when: string;
    by: {
      displayName: string;
      email?: string;
    };
  };
  ancestors: Array<{
    id: string;
    title: string;
  }>;
  metadata: {
    labels: {
      results: Array<{
        name: string;
        prefix: string;
      }>;
    };
  };
  _links: {
    webui: string;
    self: string;
  };
}

export interface ConfluenceSearchResult {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
  _links: {
    next?: string;
  };
}

export interface PageMetadata {
  pageId: string;
  title: string;
  spaceKey: string;
  spaceName: string;
  labels: string[];
  author: string;
  lastModified: string;
  version: number;
  url: string;
  ancestors: string[]; // Breadcrumb path
}
```

### 2.3 Confluence Client

**src/confluence/client.ts:**

```typescript
import type {
  ConfluencePage,
  ConfluenceSearchResult,
  PageMetadata,
} from "./types.js";

export interface ConfluenceClientConfig {
  baseUrl: string;
  username: string;
  apiToken: string;
}

export class ConfluenceClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: ConfluenceClientConfig) {
    // Remove trailing slash and ensure /wiki for cloud
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    const credentials = Buffer.from(
      `${config.username}:${config.apiToken}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}/rest/api${endpoint}`;
    const response = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Confluence API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Get all pages from a space
   */
  async getPagesInSpace(
    spaceKey: string,
    options: { limit?: number; start?: number } = {}
  ): Promise<ConfluenceSearchResult> {
    const { limit = 50, start = 0 } = options;
    const expand = [
      "body.storage",
      "version",
      "ancestors",
      "metadata.labels",
      "space",
    ].join(",");

    return this.fetch<ConfluenceSearchResult>(
      `/content?spaceKey=${spaceKey}&type=page&expand=${expand}&limit=${limit}&start=${start}`
    );
  }

  /**
   * Get all pages from a space with pagination
   */
  async *getAllPagesInSpace(spaceKey: string): AsyncGenerator<ConfluencePage> {
    let start = 0;
    const limit = 50;

    while (true) {
      const result = await this.getPagesInSpace(spaceKey, { limit, start });

      for (const page of result.results) {
        yield page;
      }

      if (result.size < limit || !result._links.next) {
        break;
      }

      start += limit;
    }
  }

  /**
   * Get a single page by ID
   */
  async getPage(pageId: string): Promise<ConfluencePage> {
    const expand = [
      "body.storage",
      "version",
      "ancestors",
      "metadata.labels",
      "space",
    ].join(",");

    return this.fetch<ConfluencePage>(`/content/${pageId}?expand=${expand}`);
  }

  /**
   * Get pages modified since a specific date
   */
  async getModifiedPages(
    spaceKey: string,
    since: Date
  ): Promise<ConfluencePage[]> {
    const cql = `space = "${spaceKey}" AND type = "page" AND lastModified >= "${since.toISOString().split("T")[0]}"`;
    const expand = [
      "body.storage",
      "version",
      "ancestors",
      "metadata.labels",
      "space",
    ].join(",");

    const result = await this.fetch<ConfluenceSearchResult>(
      `/content/search?cql=${encodeURIComponent(cql)}&expand=${expand}&limit=100`
    );

    return result.results;
  }

  /**
   * Extract metadata from a page
   */
  extractMetadata(page: ConfluencePage): PageMetadata {
    return {
      pageId: page.id,
      title: page.title,
      spaceKey: page.space.key,
      spaceName: page.space.name,
      labels: page.metadata.labels.results.map((l) => l.name),
      author: page.version.by.displayName,
      lastModified: page.version.when,
      version: page.version.number,
      url: `${this.baseUrl}${page._links.webui}`,
      ancestors: page.ancestors.map((a) => a.title),
    };
  }

  /**
   * Check if a page should be included based on label filters
   */
  shouldIncludePage(
    page: ConfluencePage,
    options: {
      includeLabels?: string[];
      excludeLabels?: string[];
    }
  ): boolean {
    const pageLabels = page.metadata.labels.results.map((l) => l.name);

    // Check exclude labels first
    if (options.excludeLabels?.length) {
      const hasExcluded = pageLabels.some((label) =>
        options.excludeLabels!.includes(label)
      );
      if (hasExcluded) {
        return false;
      }
    }

    // If include labels specified, page must have at least one
    if (options.includeLabels?.length) {
      const hasIncluded = pageLabels.some((label) =>
        options.includeLabels!.includes(label)
      );
      return hasIncluded;
    }

    return true;
  }
}
```

### 2.4 Confluence Client Export

**src/confluence/index.ts:**

```typescript
export { ConfluenceClient } from "./client.js";
export type {
  ConfluencePage,
  ConfluenceSearchResult,
  PageMetadata,
} from "./types.js";
```

---

## Phase 3: Chunking Pipeline

### 3.1 Chunk Types

**src/chunking/types.ts:**

```typescript
import type { PageMetadata } from "../confluence/types.js";

export interface Chunk {
  id: string; // Unique chunk ID: pageId_chunkIndex
  content: string; // The chunk text content
  metadata: ChunkMetadata;
}

export interface ChunkMetadata extends PageMetadata {
  chunkIndex: number;
  totalChunks: number;
  headerPath: string[]; // Hierarchy of headers leading to this chunk
  contentType: "text" | "code" | "table" | "mixed";
}

export interface ChunkingOptions {
  maxTokens: number;
  overlapTokens: number;
  preserveCodeBlocks: boolean;
  preserveTables: boolean;
}
```

### 3.2 HTML Chunker

**src/chunking/html-chunker.ts:**

```typescript
import { parse, HTMLElement, Node, NodeType } from "node-html-parser";
import type { Chunk, ChunkMetadata, ChunkingOptions } from "./types.js";
import type { PageMetadata } from "../confluence/types.js";

/**
 * Rough token count estimation (1 token ≈ 4 chars for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract text content from HTML, preserving structure hints
 */
function htmlToText(node: Node, preserveStructure = true): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return node.text.trim();
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  const tag = element.tagName?.toLowerCase();

  // Handle special elements
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n";

  // Code blocks
  if (tag === "pre" || tag === "code") {
    const code = element.text.trim();
    if (tag === "pre" || element.parentNode?.rawTagName?.toLowerCase() === "pre") {
      return `\n\`\`\`\n${code}\n\`\`\`\n`;
    }
    return `\`${code}\``;
  }

  // Tables - convert to markdown-ish format
  if (tag === "table") {
    return convertTableToText(element);
  }

  // Lists
  if (tag === "li") {
    const content = element.childNodes.map((c) => htmlToText(c, preserveStructure)).join("");
    return `• ${content}\n`;
  }

  // Paragraphs and divs
  if (tag === "p" || tag === "div") {
    const content = element.childNodes.map((c) => htmlToText(c, preserveStructure)).join("");
    return content ? `${content}\n\n` : "";
  }

  // Headers - add markdown-style markers
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1]);
    const prefix = "#".repeat(level);
    const content = element.childNodes.map((c) => htmlToText(c, false)).join("");
    return `\n${prefix} ${content}\n\n`;
  }

  // Default: recurse into children
  return element.childNodes.map((c) => htmlToText(c, preserveStructure)).join("");
}

function convertTableToText(table: HTMLElement): string {
  const rows: string[][] = [];

  const tableRows = table.querySelectorAll("tr");
  for (const row of tableRows) {
    const cells = row.querySelectorAll("th, td");
    rows.push(cells.map((cell) => cell.text.trim()));
  }

  if (rows.length === 0) return "";

  // Format as simple text table
  const lines = rows.map((row) => `| ${row.join(" | ")} |`);
  if (lines.length > 1) {
    // Add separator after header
    const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
    lines.splice(1, 0, separator);
  }

  return `\n${lines.join("\n")}\n\n`;
}

interface Section {
  headerPath: string[];
  content: string;
  contentType: "text" | "code" | "table" | "mixed";
}

/**
 * Split HTML content into sections by headers
 */
function splitByHeaders(html: string): Section[] {
  const root = parse(html);
  const sections: Section[] = [];
  let currentSection: Section = {
    headerPath: [],
    content: "",
    contentType: "text",
  };
  const headerStack: string[] = [];

  function processNode(node: Node) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) {
      if (node.nodeType === NodeType.TEXT_NODE && node.text.trim()) {
        currentSection.content += node.text;
      }
      return;
    }

    const element = node as HTMLElement;
    const tag = element.tagName?.toLowerCase();

    // Check if it's a header
    if (/^h[1-6]$/.test(tag)) {
      // Save current section if it has content
      if (currentSection.content.trim()) {
        sections.push({ ...currentSection });
      }

      const level = parseInt(tag[1]);
      const headerText = element.text.trim();

      // Update header stack
      while (headerStack.length >= level) {
        headerStack.pop();
      }
      headerStack.push(headerText);

      // Start new section
      currentSection = {
        headerPath: [...headerStack],
        content: "",
        contentType: "text",
      };
      return;
    }

    // Detect content type
    if (tag === "pre" || tag === "code") {
      if (currentSection.contentType === "text") {
        currentSection.contentType = "code";
      } else if (currentSection.contentType !== "code") {
        currentSection.contentType = "mixed";
      }
    }
    if (tag === "table") {
      if (currentSection.contentType === "text") {
        currentSection.contentType = "table";
      } else if (currentSection.contentType !== "table") {
        currentSection.contentType = "mixed";
      }
    }

    // Add content
    currentSection.content += htmlToText(element);
  }

  // Process all top-level children
  for (const child of root.childNodes) {
    processNode(child);
  }

  // Don't forget the last section
  if (currentSection.content.trim()) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Split a section into smaller chunks if needed
 */
function splitSection(
  section: Section,
  options: ChunkingOptions
): Section[] {
  const tokens = estimateTokens(section.content);

  if (tokens <= options.maxTokens) {
    return [section];
  }

  // Split by paragraphs first
  const paragraphs = section.content.split(/\n\n+/);
  const chunks: Section[] = [];
  let currentChunk = "";
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (currentTokens + paraTokens > options.maxTokens && currentChunk) {
      chunks.push({
        ...section,
        content: currentChunk.trim(),
      });

      // Start new chunk with overlap
      const overlapText = getOverlapText(currentChunk, options.overlapTokens);
      currentChunk = overlapText + para + "\n\n";
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += para + "\n\n";
      currentTokens += paraTokens;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      ...section,
      content: currentChunk.trim(),
    });
  }

  return chunks;
}

/**
 * Get overlap text from the end of content
 */
function getOverlapText(content: string, overlapTokens: number): string {
  const targetChars = overlapTokens * 4;
  if (content.length <= targetChars) {
    return content;
  }

  // Try to break at a sentence or word boundary
  const overlapStart = content.length - targetChars;
  const text = content.slice(overlapStart);

  // Find first sentence or word boundary
  const sentenceMatch = text.match(/^[^.!?]*[.!?]\s*/);
  if (sentenceMatch) {
    return text.slice(sentenceMatch[0].length);
  }

  const wordMatch = text.match(/^\S*\s+/);
  if (wordMatch) {
    return text.slice(wordMatch[0].length);
  }

  return text;
}

/**
 * Main chunking function
 */
export function chunkHtmlContent(
  html: string,
  pageMetadata: PageMetadata,
  options: ChunkingOptions
): Chunk[] {
  // Split by headers first
  const sections = splitByHeaders(html);

  // Split large sections
  const allSections: Section[] = [];
  for (const section of sections) {
    allSections.push(...splitSection(section, options));
  }

  // Convert to chunks with metadata
  const chunks: Chunk[] = allSections.map((section, index) => {
    // Build context prefix
    const contextParts = [
      `Page: ${pageMetadata.title}`,
      pageMetadata.ancestors.length > 0
        ? `Path: ${pageMetadata.ancestors.join(" > ")}`
        : null,
      section.headerPath.length > 0
        ? `Section: ${section.headerPath.join(" > ")}`
        : null,
    ].filter(Boolean);

    const contextPrefix = contextParts.join("\n") + "\n\n";

    return {
      id: `${pageMetadata.pageId}_${index}`,
      content: contextPrefix + section.content.trim(),
      metadata: {
        ...pageMetadata,
        chunkIndex: index,
        totalChunks: allSections.length,
        headerPath: section.headerPath,
        contentType: section.contentType,
      },
    };
  });

  return chunks;
}
```

### 3.3 Chunking Export

**src/chunking/index.ts:**

```typescript
export { chunkHtmlContent } from "./html-chunker.js";
export type { Chunk, ChunkMetadata, ChunkingOptions } from "./types.js";
```

---

## Phase 4: Qdrant Integration

### 4.1 Qdrant Client

**src/qdrant/client.ts:**

```typescript
import { QdrantClient as QdrantSDK } from "@qdrant/js-client-rest";
import type { Chunk, ChunkMetadata } from "../chunking/types.js";

export interface QdrantConfig {
  url: string;
  collectionName: string;
  apiKey?: string;
  vectorSize: number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export class QdrantClient {
  private client: QdrantSDK;
  private collectionName: string;
  private vectorSize: number;

  constructor(config: QdrantConfig) {
    this.client = new QdrantSDK({
      url: config.url,
      apiKey: config.apiKey,
    });
    this.collectionName = config.collectionName;
    this.vectorSize = config.vectorSize;
  }

  /**
   * Initialize collection if it doesn't exist
   */
  async initCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (c) => c.name === this.collectionName
    );

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: "Cosine",
        },
      });

      // Create payload indexes for filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "spaceKey",
        field_schema: "keyword",
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "labels",
        field_schema: "keyword",
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: "pageId",
        field_schema: "keyword",
      });

      console.log(`Created collection: ${this.collectionName}`);
    }
  }

  /**
   * Upsert chunks with their embeddings
   */
  async upsertChunks(
    chunks: Chunk[],
    embeddings: number[][]
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error("Chunks and embeddings count mismatch");
    }

    const points = chunks.map((chunk, i) => ({
      id: this.generatePointId(chunk.id),
      vector: embeddings[i],
      payload: {
        chunkId: chunk.id,
        content: chunk.content,
        ...chunk.metadata,
      },
    }));

    // Upsert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      await this.client.upsert(this.collectionName, {
        wait: true,
        points: batch,
      });
    }
  }

  /**
   * Delete all chunks for a specific page
   */
  async deletePageChunks(pageId: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      wait: true,
      filter: {
        must: [
          {
            key: "pageId",
            match: { value: pageId },
          },
        ],
      },
    });
  }

  /**
   * Search for similar chunks
   */
  async search(
    queryVector: number[],
    options: {
      limit?: number;
      spaceKey?: string;
      labels?: string[];
      scoreThreshold?: number;
    } = {}
  ): Promise<SearchResult[]> {
    const { limit = 5, spaceKey, labels, scoreThreshold = 0.7 } = options;

    const filter: Record<string, unknown> = { must: [] };

    if (spaceKey) {
      (filter.must as unknown[]).push({
        key: "spaceKey",
        match: { value: spaceKey },
      });
    }

    if (labels?.length) {
      (filter.must as unknown[]).push({
        key: "labels",
        match: { any: labels },
      });
    }

    const results = await this.client.search(this.collectionName, {
      vector: queryVector,
      limit,
      filter: (filter.must as unknown[]).length > 0 ? filter : undefined,
      score_threshold: scoreThreshold,
      with_payload: true,
    });

    return results.map((result) => ({
      chunk: {
        id: result.payload?.chunkId as string,
        content: result.payload?.content as string,
        metadata: {
          pageId: result.payload?.pageId,
          title: result.payload?.title,
          spaceKey: result.payload?.spaceKey,
          spaceName: result.payload?.spaceName,
          labels: result.payload?.labels,
          author: result.payload?.author,
          lastModified: result.payload?.lastModified,
          version: result.payload?.version,
          url: result.payload?.url,
          ancestors: result.payload?.ancestors,
          chunkIndex: result.payload?.chunkIndex,
          totalChunks: result.payload?.totalChunks,
          headerPath: result.payload?.headerPath,
          contentType: result.payload?.contentType,
        } as ChunkMetadata,
      },
      score: result.score,
    }));
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(): Promise<{
    pointsCount: number;
    vectorsCount: number;
  }> {
    const info = await this.client.getCollection(this.collectionName);
    return {
      pointsCount: info.points_count ?? 0,
      vectorsCount: info.vectors_count ?? 0,
    };
  }

  /**
   * Generate a numeric point ID from string chunk ID
   */
  private generatePointId(chunkId: string): number {
    // Simple hash function for converting string to number
    let hash = 0;
    for (let i = 0; i < chunkId.length; i++) {
      const char = chunkId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
```

### 4.2 Qdrant Export

**src/qdrant/index.ts:**

```typescript
export { QdrantClient } from "./client.js";
export type { QdrantConfig, SearchResult } from "./client.js";
```

---

## Phase 5: Ingestion Pipeline

### 5.1 Ingestion Logic

**src/pipeline/ingest.ts:**

```typescript
import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { Chunk, ChunkingOptions } from "../chunking/types.js";

export interface IngestOptions {
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  batchSize?: number;
  verbose?: boolean;
}

export interface IngestResult {
  pagesProcessed: number;
  pagesSkipped: number;
  chunksCreated: number;
  errors: Array<{ pageId: string; error: string }>;
}

export async function ingestConfluenceToQdrant(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  options: IngestOptions
): Promise<IngestResult> {
  const {
    spaces,
    includeLabels,
    excludeLabels,
    chunkingOptions,
    batchSize = 10,
    verbose = false,
  } = options;

  const result: IngestResult = {
    pagesProcessed: 0,
    pagesSkipped: 0,
    chunksCreated: 0,
    errors: [],
  };

  const log = verbose ? console.log : () => {};

  // Initialize collection
  await qdrant.initCollection();

  for (const spaceKey of spaces) {
    log(`\nProcessing space: ${spaceKey}`);

    const chunksBuffer: Chunk[] = [];

    for await (const page of confluence.getAllPagesInSpace(spaceKey)) {
      try {
        // Check label filters
        if (!confluence.shouldIncludePage(page, { includeLabels, excludeLabels })) {
          log(`  Skipping (label filter): ${page.title}`);
          result.pagesSkipped++;
          continue;
        }

        log(`  Processing: ${page.title}`);

        // Extract metadata
        const metadata = confluence.extractMetadata(page);

        // Get HTML content
        const html = page.body.storage.value;

        // Chunk the content
        const chunks = chunkHtmlContent(html, metadata, chunkingOptions);
        log(`    Created ${chunks.length} chunks`);

        // Delete existing chunks for this page (for updates)
        await qdrant.deletePageChunks(page.id);

        // Add to buffer
        chunksBuffer.push(...chunks);
        result.pagesProcessed++;
        result.chunksCreated += chunks.length;

        // Process buffer when it reaches batch size
        if (chunksBuffer.length >= batchSize) {
          await processChunkBatch(chunksBuffer.splice(0, batchSize), embedding, qdrant, log);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`    Error: ${errorMsg}`);
        result.errors.push({ pageId: page.id, error: errorMsg });
      }
    }

    // Process remaining chunks
    if (chunksBuffer.length > 0) {
      await processChunkBatch(chunksBuffer, embedding, qdrant, log);
    }
  }

  return result;
}

async function processChunkBatch(
  chunks: Chunk[],
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  log: (msg: string) => void
): Promise<void> {
  log(`  Embedding ${chunks.length} chunks...`);

  // Generate embeddings
  const texts = chunks.map((c) => c.content);
  const embeddings = await embedding.embed(texts);

  // Store in Qdrant
  await qdrant.upsertChunks(chunks, embeddings);

  log(`  Stored ${chunks.length} chunks in Qdrant`);
}
```

### 5.2 Sync Logic

**src/pipeline/sync.ts:**

```typescript
import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { chunkHtmlContent } from "../chunking/index.js";
import type { ChunkingOptions } from "../chunking/types.js";

export interface SyncOptions {
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
  lastSyncTime?: Date;
  verbose?: boolean;
}

export interface SyncResult {
  pagesUpdated: number;
  pagesDeleted: number;
  chunksCreated: number;
  syncTime: Date;
}

/**
 * Sync only modified pages since last sync
 */
export async function syncConfluence(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  options: SyncOptions
): Promise<SyncResult> {
  const {
    spaces,
    includeLabels,
    excludeLabels,
    chunkingOptions,
    lastSyncTime = new Date(Date.now() - 24 * 60 * 60 * 1000), // Default: last 24 hours
    verbose = false,
  } = options;

  const log = verbose ? console.log : () => {};
  const syncTime = new Date();

  const result: SyncResult = {
    pagesUpdated: 0,
    pagesDeleted: 0,
    chunksCreated: 0,
    syncTime,
  };

  for (const spaceKey of spaces) {
    log(`\nSyncing space: ${spaceKey}`);

    // Get modified pages
    const modifiedPages = await confluence.getModifiedPages(spaceKey, lastSyncTime);
    log(`  Found ${modifiedPages.length} modified pages`);

    for (const page of modifiedPages) {
      // Check label filters
      if (!confluence.shouldIncludePage(page, { includeLabels, excludeLabels })) {
        // Page now has exclude label - delete from Qdrant
        log(`  Deleting (excluded by label): ${page.title}`);
        await qdrant.deletePageChunks(page.id);
        result.pagesDeleted++;
        continue;
      }

      log(`  Updating: ${page.title}`);

      // Extract metadata and chunk
      const metadata = confluence.extractMetadata(page);
      const html = page.body.storage.value;
      const chunks = chunkHtmlContent(html, metadata, chunkingOptions);

      // Delete old chunks and insert new
      await qdrant.deletePageChunks(page.id);

      if (chunks.length > 0) {
        const texts = chunks.map((c) => c.content);
        const embeddings = await embedding.embed(texts);
        await qdrant.upsertChunks(chunks, embeddings);
      }

      result.pagesUpdated++;
      result.chunksCreated += chunks.length;
    }
  }

  return result;
}
```

### 5.3 Pipeline Export

**src/pipeline/index.ts:**

```typescript
export { ingestConfluenceToQdrant } from "./ingest.js";
export { syncConfluence } from "./sync.js";
export type { IngestOptions, IngestResult } from "./ingest.js";
export type { SyncOptions, SyncResult } from "./sync.js";
```

---

## Phase 6: Scheduler and CLI

### 6.1 Cron Scheduler

**src/scheduler/cron.ts:**

```typescript
import cron from "node-cron";
import type { ConfluenceClient } from "../confluence/index.js";
import type { EmbeddingClient } from "../embeddings/index.js";
import type { QdrantClient } from "../qdrant/index.js";
import { syncConfluence } from "../pipeline/index.js";
import type { ChunkingOptions } from "../chunking/types.js";

export interface SchedulerConfig {
  cronSchedule: string;
  spaces: string[];
  includeLabels?: string[];
  excludeLabels?: string[];
  chunkingOptions: ChunkingOptions;
}

export function startSyncScheduler(
  confluence: ConfluenceClient,
  embedding: EmbeddingClient,
  qdrant: QdrantClient,
  config: SchedulerConfig
): cron.ScheduledTask {
  let lastSyncTime = new Date();

  console.log(`Starting sync scheduler with cron: ${config.cronSchedule}`);

  const task = cron.schedule(config.cronSchedule, async () => {
    console.log(`\n[${new Date().toISOString()}] Starting scheduled sync...`);

    try {
      const result = await syncConfluence(confluence, embedding, qdrant, {
        spaces: config.spaces,
        includeLabels: config.includeLabels,
        excludeLabels: config.excludeLabels,
        chunkingOptions: config.chunkingOptions,
        lastSyncTime,
        verbose: true,
      });

      console.log(`Sync complete:`);
      console.log(`  Pages updated: ${result.pagesUpdated}`);
      console.log(`  Pages deleted: ${result.pagesDeleted}`);
      console.log(`  Chunks created: ${result.chunksCreated}`);

      lastSyncTime = result.syncTime;
    } catch (error) {
      console.error("Sync failed:", error);
    }
  });

  return task;
}
```

### 6.2 CLI Entry Point

**src/index.ts:**

```typescript
import { loadConfig } from "./config.js";
import { ConfluenceClient } from "./confluence/index.js";
import { createEmbeddingClient } from "./embeddings/index.js";
import { QdrantClient } from "./qdrant/index.js";
import { ingestConfluenceToQdrant, syncConfluence } from "./pipeline/index.js";
import { startSyncScheduler } from "./scheduler/cron.js";

async function main() {
  const command = process.argv[2];

  if (!command || command === "help") {
    console.log(`
Fredy RAG - Confluence to Qdrant Pipeline

Commands:
  ingest    Full ingestion of all configured Confluence spaces
  sync      Sync only recently modified pages
  search    Search the vector database (interactive)
  daemon    Run as daemon with scheduled sync

Environment variables required:
  CONFLUENCE_BASE_URL      Confluence URL (e.g., https://your-domain.atlassian.net/wiki)
  CONFLUENCE_USERNAME      Your email/username
  CONFLUENCE_API_TOKEN     API token
  CONFLUENCE_SPACES        Comma-separated space keys (e.g., IT,DOCS,KB)

  EMBEDDING_PROVIDER       openai, voyage, or cohere
  EMBEDDING_API_KEY        API key for embedding provider
  EMBEDDING_MODEL          Model name (e.g., text-embedding-3-small)

  QDRANT_URL              Qdrant URL (default: http://localhost:6333)
  QDRANT_COLLECTION       Collection name (default: confluence-pages)

Optional:
  CONFLUENCE_INCLUDE_LABELS   Only include pages with these labels
  CONFLUENCE_EXCLUDE_LABELS   Exclude pages with these labels (default: ignore,draft,archived)
  SYNC_CRON                   Cron schedule for daemon mode (default: 0 */6 * * *)
`);
    return;
  }

  // Load configuration
  const config = loadConfig();

  // Initialize clients
  const confluence = new ConfluenceClient({
    baseUrl: config.confluence.baseUrl,
    username: config.confluence.username,
    apiToken: config.confluence.apiToken,
  });

  const embedding = createEmbeddingClient({
    provider: config.embedding.provider,
    apiKey: config.embedding.apiKey,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });

  const qdrant = new QdrantClient({
    url: config.qdrant.url,
    collectionName: config.qdrant.collectionName,
    apiKey: config.qdrant.apiKey,
    vectorSize: config.embedding.dimensions,
  });

  switch (command) {
    case "ingest": {
      console.log("Starting full ingestion...\n");
      const result = await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
        verbose: true,
      });

      console.log("\n=== Ingestion Complete ===");
      console.log(`Pages processed: ${result.pagesProcessed}`);
      console.log(`Pages skipped: ${result.pagesSkipped}`);
      console.log(`Chunks created: ${result.chunksCreated}`);
      if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.length}`);
        result.errors.forEach((e) => console.log(`  - ${e.pageId}: ${e.error}`));
      }
      break;
    }

    case "sync": {
      console.log("Starting incremental sync...\n");
      const result = await syncConfluence(confluence, embedding, qdrant, {
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
        verbose: true,
      });

      console.log("\n=== Sync Complete ===");
      console.log(`Pages updated: ${result.pagesUpdated}`);
      console.log(`Pages deleted: ${result.pagesDeleted}`);
      console.log(`Chunks created: ${result.chunksCreated}`);
      break;
    }

    case "search": {
      const query = process.argv[3];
      if (!query) {
        console.error("Usage: search <query>");
        process.exit(1);
      }

      console.log(`Searching for: "${query}"\n`);

      await qdrant.initCollection();
      const queryVector = await embedding.embedSingle(query);
      const results = await qdrant.search(queryVector, { limit: 5 });

      console.log(`Found ${results.length} results:\n`);
      for (const result of results) {
        console.log(`--- Score: ${result.score.toFixed(3)} ---`);
        console.log(`Title: ${result.chunk.metadata.title}`);
        console.log(`Space: ${result.chunk.metadata.spaceKey}`);
        console.log(`URL: ${result.chunk.metadata.url}`);
        console.log(`Content preview: ${result.chunk.content.slice(0, 200)}...`);
        console.log();
      }
      break;
    }

    case "daemon": {
      console.log("Starting RAG daemon...\n");

      // Initialize collection
      await qdrant.initCollection();

      // Do full sync on start if configured
      if (config.sync.fullSyncOnStart) {
        console.log("Running initial full ingestion...\n");
        await ingestConfluenceToQdrant(confluence, embedding, qdrant, {
          spaces: config.confluence.spaces,
          includeLabels: config.confluence.includeLabels,
          excludeLabels: config.confluence.excludeLabels,
          chunkingOptions: config.chunking,
          verbose: true,
        });
      }

      // Start scheduler
      const task = startSyncScheduler(confluence, embedding, qdrant, {
        cronSchedule: config.sync.cronSchedule,
        spaces: config.confluence.spaces,
        includeLabels: config.confluence.includeLabels,
        excludeLabels: config.confluence.excludeLabels,
        chunkingOptions: config.chunking,
      });

      // Keep process alive
      console.log("\nDaemon running. Press Ctrl+C to stop.\n");
      process.on("SIGINT", () => {
        console.log("\nStopping daemon...");
        task.stop();
        process.exit(0);
      });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

---

## Phase 7: Agent Integration

### 7.1 RAG Tool for Agent

Create a tool that the agent can use to search the knowledge base.

**In services/agent, create src/tools/knowledge-base.ts:**

```typescript
import { z } from "zod";
import type { Tool } from "./types.js";

// Import or configure these from your RAG service
interface KnowledgeBaseConfig {
  qdrantUrl: string;
  collectionName: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingProvider: "openai" | "voyage";
}

export function createKnowledgeBaseTool(config: KnowledgeBaseConfig): Tool<
  { query: string; limit?: number; spaceKey?: string },
  { results: Array<{ title: string; content: string; url: string; score: number }> }
> {
  return {
    name: "search_knowledge_base",
    description: `Search the organizational knowledge base (Confluence) for relevant information.
Use this tool when you need to find documentation, procedures, troubleshooting guides, or any organizational knowledge.
Returns the most relevant document chunks with their source URLs.`,
    inputSchema: z.object({
      query: z.string().describe("The search query - be specific and descriptive"),
      limit: z.number().optional().default(5).describe("Maximum results to return"),
      spaceKey: z.string().optional().describe("Filter to a specific Confluence space"),
    }),
    execute: async ({ query, limit, spaceKey }) => {
      // Generate query embedding
      const embeddingResponse = await fetch(
        config.embeddingProvider === "openai"
          ? "https://api.openai.com/v1/embeddings"
          : "https://api.voyageai.com/v1/embeddings",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.embeddingApiKey}`,
          },
          body: JSON.stringify({
            model: config.embeddingModel,
            input: query,
            ...(config.embeddingProvider === "voyage" && { input_type: "query" }),
          }),
        }
      );

      if (!embeddingResponse.ok) {
        throw new Error(`Embedding failed: ${await embeddingResponse.text()}`);
      }

      const embeddingData = await embeddingResponse.json();
      const queryVector = embeddingData.data[0].embedding;

      // Search Qdrant
      const searchResponse = await fetch(
        `${config.qdrantUrl}/collections/${config.collectionName}/points/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vector: queryVector,
            limit,
            with_payload: true,
            filter: spaceKey
              ? { must: [{ key: "spaceKey", match: { value: spaceKey } }] }
              : undefined,
          }),
        }
      );

      if (!searchResponse.ok) {
        throw new Error(`Search failed: ${await searchResponse.text()}`);
      }

      const searchData = await searchResponse.json();

      return {
        results: searchData.result.map((hit: {
          payload: { title: string; content: string; url: string };
          score: number;
        }) => ({
          title: hit.payload.title,
          content: hit.payload.content,
          url: hit.payload.url,
          score: hit.score,
        })),
      };
    },
  };
}
```

### 7.2 Register Tool in Agent

Update the agent's index.ts to include the knowledge base tool:

```typescript
import { createKnowledgeBaseTool } from "./tools/knowledge-base.js";

// Add to tool registry
const kbTool = createKnowledgeBaseTool({
  qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
  collectionName: process.env.QDRANT_COLLECTION ?? "confluence-pages",
  embeddingApiKey: process.env.EMBEDDING_API_KEY!,
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  embeddingProvider: (process.env.EMBEDDING_PROVIDER ?? "openai") as "openai" | "voyage",
});

const tools = new ToolRegistry()
  .register(kbTool)
  // ... other tools
```

---

## Environment Variables

Create or update **.env.example**:

```env
# Confluence Configuration
CONFLUENCE_BASE_URL=https://your-domain.atlassian.net/wiki
CONFLUENCE_USERNAME=your-email@example.com
CONFLUENCE_API_TOKEN=your-api-token
CONFLUENCE_SPACES=IT,DOCS,KB

# Label Filtering (optional)
CONFLUENCE_INCLUDE_LABELS=
CONFLUENCE_EXCLUDE_LABELS=ignore,draft,archived

# Embedding Configuration
EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=your-openai-api-key
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Qdrant Configuration
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=confluence-pages

# Sync Configuration
SYNC_CRON=0 */6 * * *
SYNC_FULL_ON_START=false

# Chunking (optional)
CHUNK_MAX_TOKENS=800
CHUNK_OVERLAP_TOKENS=100
```

---

## Testing

### Test Commands

```bash
# Navigate to RAG service
cd services/rag

# Install dependencies
pnpm install

# Test ingestion (make sure .env is configured)
pnpm run ingest

# Test search
pnpm run search "how to reset password"

# Run daemon for continuous sync
pnpm run dev daemon
```

### Verify in Qdrant Dashboard

Open http://localhost:6333/dashboard to inspect:
- Collection created
- Points count
- Sample payloads

---

## Next Steps

After implementing this guide:

1. **MCP Server Integration**: Expose the search functionality via MCP for use with other clients
2. **Hybrid Search**: Add BM25/keyword search alongside vector search
3. **Re-ranking**: Add a re-ranking step using Cohere or similar
4. **Caching**: Cache embeddings for frequently searched queries
5. **Monitoring**: Add metrics for sync status, search latency, and errors
