export interface ToolDescription {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface ToolChunkMetadata {
  id: string;
  score?: number;
  url?: string;
  title?: string;
  spaceKey?: string;
}

export interface ToolResult<TOutput = unknown> {
  success: boolean;
  output: string;
  data?: TOutput;
  metadata?: {
    chunks?: ToolChunkMetadata[];
  };
}

export interface Tool<TInput = Record<string, unknown>, TOutput = unknown> {
  readonly description: ToolDescription;
  execute(input: TInput): Promise<ToolResult<TOutput>>;
}
