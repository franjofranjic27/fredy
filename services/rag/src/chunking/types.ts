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
