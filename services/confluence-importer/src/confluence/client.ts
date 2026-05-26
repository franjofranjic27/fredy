import { withRetry } from "../utils/retry.js";
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
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: ConfluenceClientConfig) {
    // Remove trailing slash
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    const credentials = Buffer.from(
      `${config.username}:${config.apiToken}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    return withRetry(async () => {
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

      return response.json() as Promise<T>;
    });
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
