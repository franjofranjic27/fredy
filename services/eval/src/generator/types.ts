export interface SampledChunk {
  readonly chunkId: string;
  readonly pageId: string;
  readonly content: string;
  readonly metadata: SampledChunkMetadata;
}

export interface SampledChunkMetadata {
  readonly title: string;
  readonly spaceKey: string;
  readonly spaceName?: string;
  readonly headerPath: readonly string[];
  readonly chunkIndex: number;
  readonly totalChunks: number;
}

export interface GeneratedQuestion {
  readonly question: string;
  readonly rationale: string;
}

export interface GoldenRecord {
  readonly queryId: string;
  readonly query: string;
  readonly relevantChunkIds: readonly string[];
  readonly source: "synthetic";
  readonly metadata: GoldenRecordMetadata;
}

export interface GoldenRecordMetadata {
  readonly sourcePageId: string;
  readonly sourcePageTitle: string;
  readonly sourceSpaceKey: string;
  readonly generatedBy: string;
  readonly generatedAt: string;
}

export interface GeneratorConfig {
  readonly count: number;
  readonly spaceKey?: string;
  readonly outputPath: string;
  readonly seed: number;
  readonly concurrency: number;
}
