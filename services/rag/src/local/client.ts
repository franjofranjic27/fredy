import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import type { LocalFile } from "./types.js";
import type { PageMetadata } from "../confluence/types.js";

export interface LocalFileClientConfig {
  directory: string;
  extensions: string[];
}

export class LocalFileClient {
  private directory: string;
  private extensions: Set<string>;

  constructor(config: LocalFileClientConfig) {
    this.directory = config.directory;
    this.extensions = new Set(config.extensions.map((e) => e.toLowerCase()));
  }

  /**
   * Recursively scan directory and yield matching files
   */
  async *getAllFiles(): AsyncGenerator<LocalFile> {
    yield* this.scanDirectory(this.directory);
  }

  private async *scanDirectory(dir: string): AsyncGenerator<LocalFile> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        yield* this.scanDirectory(fullPath);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!this.extensions.has(ext)) continue;

        try {
          const content = await readFile(fullPath, "utf-8");
          const fileStat = await stat(fullPath);

          yield {
            filePath: fullPath,
            relativePath: relative(this.directory, fullPath),
            fileName: basename(entry.name, ext),
            extension: ext,
            content,
            modifiedAt: fileStat.mtime,
          };
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  /**
   * Extract PageMetadata from a local file (compatible with Confluence pipeline)
   */
  extractMetadata(file: LocalFile): PageMetadata {
    const pathHash = createHash("md5")
      .update(file.relativePath)
      .digest("hex")
      .slice(0, 12);

    // Use subdirectory segments as ancestors
    const parts = file.relativePath.split("/");
    const ancestors = parts.length > 1 ? parts.slice(0, -1) : [];

    return {
      pageId: `local_${pathHash}`,
      title: file.fileName,
      spaceKey: "local",
      spaceName: "Local Files",
      labels: [],
      author: "local",
      lastModified: file.modifiedAt.toISOString(),
      version: 1,
      url: `file://${file.filePath}`,
      ancestors,
    };
  }
}
