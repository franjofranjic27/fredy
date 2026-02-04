# Fredy Agent Implementation Guide

This guide provides step-by-step instructions for implementing an AI agent system with tool capabilities.

## Overview

**Goal**: Build a two-phase AI agent system:
1. **Phase 1**: Client (Open-WebUI) connected to Claude API
2. **Phase 2**: Custom TypeScript agent with MCP server tool integration

**Tech Stack**:
- Runtime: Node.js with TypeScript
- Package Manager: pnpm
- LLM Provider: Anthropic Claude API
- Client: Open-WebUI
- Tools: MCP (Model Context Protocol) servers

---

## Phase 1: Client Connected to Cloud Model

### Objective
Configure Open-WebUI to use Claude as the LLM backend instead of local Ollama models.

### Steps

#### 1.1 Update Docker Compose Configuration

Modify `docker-compose.yml` to configure Open-WebUI for Claude:

```yaml
openwebui:
  image: ghcr.io/open-webui/open-webui:main
  container_name: open-webui
  restart: always
  ports:
    - "3000:8080"
  environment:
    # Disable Ollama requirement
    OLLAMA_BASE_URL: ""
    # Enable OpenAI-compatible endpoint (Claude via proxy or direct)
    OPENAI_API_BASE_URL: "https://api.anthropic.com/v1"
    OPENAI_API_KEY: "${ANTHROPIC_API_KEY}"
    # Or use LiteLLM as a proxy for better compatibility
  volumes:
    - open-webui:/app/backend/data
```

#### 1.2 Set Up Environment Variables

Create `.env` file in project root:

```env
ANTHROPIC_API_KEY=your-api-key-here
```

Add `.env` to `.gitignore`:

```
.env
.env.local
*.env
```

#### 1.3 Alternative: Use LiteLLM Proxy

For better Open-WebUI compatibility with Claude, add LiteLLM as a translation layer:

```yaml
litellm:
  image: ghcr.io/berriai/litellm:main-latest
  container_name: litellm
  restart: unless-stopped
  ports:
    - "4000:4000"
  environment:
    ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
  command: --model claude-sonnet-4-20250514

openwebui:
  # ... existing config
  environment:
    OPENAI_API_BASE_URL: "http://litellm:4000/v1"
    OPENAI_API_KEY: "sk-dummy"  # LiteLLM doesn't validate this
```

#### 1.4 Verify Setup

```bash
# Start services
docker compose up -d

# Check logs
docker compose logs -f openwebui

# Access Open-WebUI
open http://localhost:3000
```

---

## Phase 2: Custom Agent with MCP Tools

### Objective
Build a TypeScript agent that:
- Connects to Claude API
- Exposes tools via MCP server protocol
- Follows agent best practices (structured output, error handling, memory)

### Project Structure

```
services/
└── agent/
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts           # Entry point
    │   ├── agent.ts           # Agent orchestration
    │   ├── llm/
    │   │   ├── index.ts       # LLM client abstraction
    │   │   └── claude.ts      # Claude-specific implementation
    │   ├── tools/
    │   │   ├── index.ts       # Tool registry
    │   │   ├── types.ts       # Tool type definitions
    │   │   └── mcp-client.ts  # MCP client for external tools
    │   └── mcp-server/
    │       ├── index.ts       # MCP server entry
    │       └── handlers.ts    # Tool handlers
    └── tests/
        └── agent.test.ts
```

### Steps

#### 2.1 Initialize TypeScript Project

```bash
# Create service directory
mkdir -p services/agent
cd services/agent

# Initialize pnpm project
pnpm init

# Install dependencies
pnpm add @anthropic-ai/sdk @modelcontextprotocol/sdk zod
pnpm add -D typescript @types/node tsx vitest
```

#### 2.2 Configure TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Update `package.json`:

```json
{
  "name": "@fredy/agent",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "mcp-server": "tsx src/mcp-server/index.ts"
  }
}
```

#### 2.3 Implement LLM Client Abstraction

Create `src/llm/types.ts`:

```typescript
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export interface LLMClient {
  chat(
    messages: Message[],
    tools?: ToolDefinition[]
  ): Promise<LLMResponse>;
}
```

Create `src/llm/claude.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, Message, ToolDefinition, LLMResponse } from "./types.js";

export function createClaudeClient(apiKey: string): LLMClient {
  const client = new Anthropic({ apiKey });

  return {
    async chat(messages: Message[], tools?: ToolDefinition[]): Promise<LLMResponse> {
      const systemMessage = messages.find((m) => m.role === "system");
      const chatMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: chatMessages,
        tools: tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
        })),
      });

      const textContent = response.content.find((c) => c.type === "text");
      const toolUseBlocks = response.content.filter((c) => c.type === "tool_use");

      return {
        content: textContent?.type === "text" ? textContent.text : null,
        toolCalls: toolUseBlocks.map((t) => ({
          id: t.type === "tool_use" ? t.id : "",
          name: t.type === "tool_use" ? t.name : "",
          arguments: t.type === "tool_use" ? (t.input as Record<string, unknown>) : {},
        })),
        stopReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      };
    },
  };
}
```

#### 2.4 Implement Tool Registry

Create `src/tools/types.ts`:

```typescript
import { z } from "zod";

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
}

export type AnyTool = Tool<unknown, unknown>;
```

Create `src/tools/index.ts`:

```typescript
import type { AnyTool, Tool } from "./types.js";
import type { ToolDefinition } from "../llm/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";

export class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  register<TInput, TOutput>(tool: Tool<TInput, TOutput>): void {
    this.tools.set(tool.name, tool as AnyTool);
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  async execute(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    const parsed = tool.inputSchema.parse(args);
    return tool.execute(parsed);
  }

  toDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema) as Record<string, unknown>,
    }));
  }
}
```

#### 2.5 Implement Agent Loop

Create `src/agent.ts`:

```typescript
import type { LLMClient, Message } from "./llm/types.js";
import type { ToolRegistry } from "./tools/index.js";

export interface AgentConfig {
  llm: LLMClient;
  tools: ToolRegistry;
  systemPrompt: string;
  maxIterations?: number;
}

export interface AgentResult {
  response: string;
  toolsUsed: string[];
  iterations: number;
}

export async function runAgent(
  config: AgentConfig,
  userMessage: string
): Promise<AgentResult> {
  const { llm, tools, systemPrompt, maxIterations = 10 } = config;
  const toolsUsed: string[] = [];

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await llm.chat(messages, tools.toDefinitions());

    // If no tool calls, return the response
    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      return {
        response: response.content ?? "",
        toolsUsed,
        iterations: i + 1,
      };
    }

    // Process tool calls
    const toolResults: string[] = [];

    for (const toolCall of response.toolCalls) {
      toolsUsed.push(toolCall.name);

      try {
        const result = await tools.execute(toolCall.name, toolCall.arguments);
        toolResults.push(
          `Tool "${toolCall.name}" returned: ${JSON.stringify(result)}`
        );
      } catch (error) {
        toolResults.push(
          `Tool "${toolCall.name}" failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Add assistant message with tool calls and tool results
    if (response.content) {
      messages.push({ role: "assistant", content: response.content });
    }
    messages.push({ role: "user", content: toolResults.join("\n\n") });
  }

  throw new Error(`Agent exceeded max iterations (${maxIterations})`);
}
```

#### 2.6 Create Example Tool

Create `src/tools/example-tool.ts`:

```typescript
import { z } from "zod";
import type { Tool } from "./types.js";

export const fetchUrlTool: Tool<{ url: string }, { status: number; body: string }> = {
  name: "fetch_url",
  description: "Fetches content from a URL and returns the response",
  inputSchema: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),
  async execute({ url }) {
    const response = await fetch(url);
    const body = await response.text();
    return {
      status: response.status,
      body: body.slice(0, 1000), // Truncate for safety
    };
  },
};
```

#### 2.7 Create MCP Server

Create `src/mcp-server/index.ts`:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "fredy-tools",
  version: "0.1.0",
});

// Register a sample tool
server.tool(
  "search_knowledge_base",
  "Search the IT operations knowledge base for relevant information",
  {
    query: z.string().describe("The search query"),
    limit: z.number().optional().default(5).describe("Maximum results to return"),
  },
  async ({ query, limit }) => {
    // TODO: Implement actual knowledge base search (Qdrant/pgvector)
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            query,
            results: [
              { title: "Example KB Article", snippet: "This is a placeholder result" },
            ],
          }),
        },
      ],
    };
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Fredy MCP Server running on stdio");
}

main().catch(console.error);
```

#### 2.8 Wire Everything Together

Create `src/index.ts`:

```typescript
import { createClaudeClient } from "./llm/claude.js";
import { ToolRegistry } from "./tools/index.js";
import { fetchUrlTool } from "./tools/example-tool.js";
import { runAgent } from "./agent.js";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable required");
  }

  // Initialize LLM client
  const llm = createClaudeClient(apiKey);

  // Initialize tool registry
  const tools = new ToolRegistry();
  tools.register(fetchUrlTool);

  // Run agent
  const result = await runAgent(
    {
      llm,
      tools,
      systemPrompt: `You are Fredy, an IT Operations assistant.
You help users find information and solve technical problems.
Use the available tools to gather information before answering.
Be concise and accurate in your responses.`,
    },
    process.argv[2] ?? "What can you help me with?"
  );

  console.log("\n=== Agent Response ===");
  console.log(result.response);
  console.log(`\nTools used: ${result.toolsUsed.join(", ") || "none"}`);
  console.log(`Iterations: ${result.iterations}`);
}

main().catch(console.error);
```

#### 2.9 Add to Docker Compose (Optional)

Add the agent service to `docker-compose.yml`:

```yaml
agent:
  build:
    context: ./services/agent
    dockerfile: Dockerfile
  container_name: fredy-agent
  environment:
    ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}"
    QDRANT_URL: "http://qdrant:6333"
  depends_on:
    - qdrant
```

Create `services/agent/Dockerfile`:

```dockerfile
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

CMD ["node", "dist/index.js"]
```

---

## Best Practices Implemented

### Agent Design
- **Tool abstraction**: Generic tool interface with Zod schema validation
- **Agentic loop**: Iterative tool use with max iteration guard
- **Error handling**: Tool failures don't crash the agent
- **LLM abstraction**: Easy to swap Claude for other providers

### Code Quality
- **Type safety**: Full TypeScript with strict mode
- **Schema validation**: Zod for runtime type checking
- **Modular structure**: Clear separation of concerns
- **Testable**: Each component can be unit tested

### MCP Integration
- **Standard protocol**: Uses official MCP SDK
- **Stdio transport**: Works with any MCP-compatible client
- **Extensible**: Easy to add new tools

---

## Next Steps

After completing Phase 1 and 2:

1. **Add Qdrant integration**: Implement vector search tool for RAG
2. **Confluence connector**: MCP server for fetching Confluence pages
3. **Memory system**: Add conversation persistence
4. **Streaming**: Implement streaming responses
5. **Observability**: Add logging and tracing (OpenTelemetry)
