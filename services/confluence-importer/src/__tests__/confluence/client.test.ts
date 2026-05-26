import { describe, it, expect } from "vitest";
import { ConfluenceClient } from "../../confluence/client.js";
import type { ConfluencePage } from "../../confluence/types.js";

function makePage(labels: string[]): ConfluencePage {
  return {
    id: "1",
    type: "page",
    status: "current",
    title: "Test Page",
    space: { key: "IT", name: "IT Space" },
    body: { storage: { value: "<p>content</p>", representation: "storage" } },
    version: {
      number: 1,
      when: "2024-01-01T00:00:00.000Z",
      by: { displayName: "Test User" },
    },
    ancestors: [],
    metadata: {
      labels: {
        results: labels.map((name) => ({ name, prefix: "global" })),
      },
    },
    _links: { webui: "/wiki/page/1", self: "https://example.com/rest/api/content/1" },
  };
}

const client = new ConfluenceClient({
  baseUrl: "https://example.atlassian.net/wiki",
  username: "test@example.com",
  apiToken: "test-token",
});

describe("ConfluenceClient.shouldIncludePage", () => {
  it("includes a page when no filters are set", () => {
    const page = makePage([]);
    expect(client.shouldIncludePage(page, {})).toBe(true);
  });

  it("excludes a page that has an excluded label", () => {
    const page = makePage(["draft", "important"]);
    expect(
      client.shouldIncludePage(page, { excludeLabels: ["draft", "archived"] })
    ).toBe(false);
  });

  it("includes a page that has a required include label", () => {
    const page = makePage(["published", "tech"]);
    expect(
      client.shouldIncludePage(page, { includeLabels: ["published"] })
    ).toBe(true);
  });

  it("excludes a page that has none of the required include labels", () => {
    const page = makePage(["tech"]);
    expect(
      client.shouldIncludePage(page, { includeLabels: ["published", "approved"] })
    ).toBe(false);
  });

  it("exclude check takes priority over include check", () => {
    // Page has both an excluded and an included label — should be excluded
    const page = makePage(["published", "draft"]);
    expect(
      client.shouldIncludePage(page, {
        includeLabels: ["published"],
        excludeLabels: ["draft"],
      })
    ).toBe(false);
  });
});
