import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createToolRegistry } from "../setup.js";

const BASE_TOOLS = ["fetch_url", "get_current_time", "calculator"];

describe("createToolRegistry", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("registers the three base tools", () => {
    delete process.env.EMBEDDING_API_KEY;
    const registry = createToolRegistry();
    expect(registry.list()).toEqual(BASE_TOOLS);
  });

  it("adds search_knowledge_base when EMBEDDING_API_KEY is set", () => {
    process.env.EMBEDDING_API_KEY = "test-key";
    const registry = createToolRegistry();
    expect(registry.list()).toEqual([...BASE_TOOLS, "search_knowledge_base"]);
  });

  it("does not add search_knowledge_base when EMBEDDING_API_KEY is absent", () => {
    delete process.env.EMBEDDING_API_KEY;
    const registry = createToolRegistry();
    expect(registry.list()).not.toContain("search_knowledge_base");
  });

  it("each base tool has a name, description, and inputSchema", () => {
    delete process.env.EMBEDDING_API_KEY;
    const registry = createToolRegistry();

    for (const name of BASE_TOOLS) {
      const tool = registry.get(name);
      expect(tool, `tool '${name}' should exist`).toBeDefined();
      expect(typeof tool!.description).toBe("string");
      expect(tool!.description.length).toBeGreaterThan(0);
      expect(tool!.inputSchema).toBeDefined();
    }
  });

  it("returns independent registries on each call", () => {
    delete process.env.EMBEDDING_API_KEY;
    const a = createToolRegistry();
    const b = createToolRegistry();
    expect(a).not.toBe(b);
  });
});
