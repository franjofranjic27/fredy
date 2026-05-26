import { formatToolsForPrompt } from "./tool-formatter";

describe("formatToolsForPrompt", () => {
  it("returns an empty string when no tools", () => {
    expect(formatToolsForPrompt([])).toBe("");
  });

  it("formats each tool with name, description and parameters", () => {
    const out = formatToolsForPrompt([
      {
        name: "vector_search",
        description: "Search the knowledge base",
        parametersJsonSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      },
    ]);
    expect(out).toContain("Available tools:");
    expect(out).toContain("Tool: vector_search");
    expect(out).toContain("Search the knowledge base");
    expect(out).toContain('"query"');
  });

  it("joins multiple tools with blank lines", () => {
    const out = formatToolsForPrompt([
      {
        name: "a",
        description: "A",
        parametersJsonSchema: {},
      },
      {
        name: "b",
        description: "B",
        parametersJsonSchema: {},
      },
    ]);
    expect(out).toMatch(/Tool: a[\s\S]+Tool: b/);
  });
});
