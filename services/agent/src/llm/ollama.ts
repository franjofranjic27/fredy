import type {
  LLMClient,
  LLMResponse,
  Message,
  ToolCall,
  ToolDefinition,
} from "./types.js";

export interface OllamaClientOptions {
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
}

export function createOllamaClient(options: OllamaClientOptions): LLMClient {
  const {
    baseUrl = "http://localhost:11434",
    model = "llama3.2",
    maxTokens = 4096,
  } = options;

  return {
    async chat(
      messages: Message[],
      tools?: ToolDefinition[],
      onDelta?: (delta: string) => Promise<void> | void,
    ): Promise<LLMResponse> {
      const ollamaMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const ollamaTools = tools?.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));

      const body: Record<string, unknown> = {
        model,
        messages: ollamaMessages,
        options: { num_predict: maxTokens },
        stream: !!onDelta,
      };
      if (ollamaTools?.length) {
        body.tools = ollamaTools;
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama request failed (${response.status}): ${errorText}`);
      }

      if (onDelta) {
        return handleStreaming(response, onDelta);
      }

      const data = (await response.json()) as OllamaResponse;
      return parseOllamaResponse(data);
    },
  };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: Array<{
    function: {
      name: string;
      arguments: Record<string, unknown> | string;
    };
  }>;
}

interface OllamaResponse {
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function parseOllamaResponse(data: OllamaResponse): LLMResponse {
  const msg = data.message;
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => ({
    id: `tool-${i}`,
    name: tc.function.name,
    arguments:
      typeof tc.function.arguments === "string"
        ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
        : tc.function.arguments,
  }));

  const stopReason = mapStopReason(data.done_reason, toolCalls.length > 0);

  return {
    content: msg.content || null,
    toolCalls,
    stopReason,
    usage: {
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    },
  };
}

function mapStopReason(
  doneReason: string | undefined,
  hasToolCalls: boolean,
): LLMResponse["stopReason"] {
  if (hasToolCalls || doneReason === "tool_calls") return "tool_use";
  return "end_turn";
}

async function handleStreaming(
  response: Response,
  onDelta: (delta: string) => Promise<void> | void,
): Promise<LLMResponse> {
  if (!response.body) {
    throw new Error("Ollama streaming response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  const toolCalls: ToolCall[] = [];
  let lastData: OllamaResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.push(""); // sentinel so remaining buffer gets processed below
    const toProcess = lines;

    for (const line of toProcess) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let chunk: OllamaResponse;
      try {
        chunk = JSON.parse(trimmed) as OllamaResponse;
      } catch {
        continue;
      }

      lastData = chunk;

      if (chunk.message?.content) {
        fullContent += chunk.message.content;
        await onDelta(chunk.message.content);
      }

      if (chunk.message?.tool_calls) {
        for (const [i, tc] of chunk.message.tool_calls.entries()) {
          toolCalls.push({
            id: `tool-${i}`,
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
                : tc.function.arguments,
          });
        }
      }
    }
  }

  // Process any remaining content in the buffer (last line without trailing \n)
  const trimmedBuffer = buffer.trim();
  if (trimmedBuffer) {
    try {
      const chunk = JSON.parse(trimmedBuffer) as OllamaResponse;
      lastData = chunk;
      if (chunk.message?.content) {
        fullContent += chunk.message.content;
        await onDelta(chunk.message.content);
      }
      if (chunk.message?.tool_calls) {
        for (const [i, tc] of chunk.message.tool_calls.entries()) {
          toolCalls.push({
            id: `tool-${i}`,
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
                : tc.function.arguments,
          });
        }
      }
    } catch {
      // ignore malformed trailing data
    }
  }

  const stopReason = mapStopReason(lastData?.done_reason, toolCalls.length > 0);

  return {
    content: fullContent || null,
    toolCalls,
    stopReason,
    usage: {
      inputTokens: lastData?.prompt_eval_count ?? 0,
      outputTokens: lastData?.eval_count ?? 0,
    },
  };
}
