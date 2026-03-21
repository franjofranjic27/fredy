import { describe, it, expect, afterEach } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server/index.js";
import { ToolRegistry } from "../tools/index.js";

type TextBlock = { type: string; text: string };
type ToolResult = { content: TextBlock[]; isError?: boolean };

async function startServer(registry: ToolRegistry) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(registry);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(clientTransport);
  return { client, server };
}

describe("createMcpServer", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("lists all tools from the registry", async () => {
    const registry = new ToolRegistry()
      .register({
        name: "tool-a",
        description: "Tool A",
        inputSchema: z.object({ x: z.string() }),
        execute: async ({ x }) => x,
      })
      .register({
        name: "tool-b",
        description: "Tool B",
        inputSchema: z.object({ y: z.number() }),
        execute: async ({ y }) => y,
      });

    ({ client } = await startServer(registry));
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name)).toEqual(["tool-a", "tool-b"]);
    expect(tools[0].description).toBe("Tool A");
    expect(tools[1].description).toBe("Tool B");
  });

  it("exposes tool input schema to clients", async () => {
    const registry = new ToolRegistry().register({
      name: "adder",
      description: "Adds two numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    ({ client } = await startServer(registry));
    const { tools } = await client.listTools();
    const schema = tools[0].inputSchema as { properties: Record<string, unknown> };

    expect(schema.properties).toHaveProperty("a");
    expect(schema.properties).toHaveProperty("b");
  });

  it("executes a tool and returns JSON-serialised result", async () => {
    const registry = new ToolRegistry().register({
      name: "adder",
      description: "Adds two numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    });

    ({ client } = await startServer(registry));
    const result = (await client.callTool({ name: "adder", arguments: { a: 3, b: 4 } })) as ToolResult;

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toBe(7);
  });

  it("returns structured objects as pretty-printed JSON", async () => {
    const registry = new ToolRegistry().register({
      name: "info",
      description: "Returns an object",
      inputSchema: z.object({}),
      execute: async () => ({ status: "ok", count: 42 }),
    });

    ({ client } = await startServer(registry));
    const result = (await client.callTool({ name: "info", arguments: {} })) as ToolResult;

    expect(JSON.parse(result.content[0].text)).toEqual({ status: "ok", count: 42 });
  });

  it("returns isError=true when the tool throws", async () => {
    const registry = new ToolRegistry().register({
      name: "boom",
      description: "Always fails",
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error("something went wrong");
      },
    });

    ({ client } = await startServer(registry));
    const result = (await client.callTool({ name: "boom", arguments: {} })) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("something went wrong");
  });

  it("includes 'Error:' prefix in error message", async () => {
    const registry = new ToolRegistry().register({
      name: "fail",
      description: "Fails",
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error("network timeout");
      },
    });

    ({ client } = await startServer(registry));
    const result = (await client.callTool({ name: "fail", arguments: {} })) as ToolResult;

    expect(result.content[0].text).toBe("Error: network timeout");
  });
});
