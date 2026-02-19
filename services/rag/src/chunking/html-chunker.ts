import { parse, HTMLElement, Node, NodeType } from "node-html-parser";
import type { Chunk, ChunkMetadata, ChunkingOptions } from "./types.js";
import type { PageMetadata } from "../confluence/types.js";

/**
 * Rough token count estimation (1 token ≈ 4 chars for English)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Convert table element to markdown-style text
 */
function convertTableToText(table: HTMLElement): string {
  const rows: string[][] = [];

  const tableRows = table.querySelectorAll("tr");
  for (const row of tableRows) {
    const cells = row.querySelectorAll("th, td");
    rows.push(cells.map((cell) => cell.text.trim()));
  }

  if (rows.length === 0) return "";

  // Format as simple text table
  const lines = rows.map((row) => `| ${row.join(" | ")} |`);
  if (lines.length > 1) {
    // Add separator after header
    const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
    lines.splice(1, 0, separator);
  }

  return `\n${lines.join("\n")}\n\n`;
}

/**
 * Extract text content from HTML, preserving structure hints
 */
function htmlToText(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return node.text.trim();
  }

  if (node.nodeType !== NodeType.ELEMENT_NODE) {
    return "";
  }

  const element = node as HTMLElement;
  const tag = element.tagName?.toLowerCase();

  // Handle special elements
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n";

  // Code blocks
  if (tag === "pre" || tag === "code") {
    const code = element.text.trim();
    if (tag === "pre" || element.parentNode?.rawTagName?.toLowerCase() === "pre") {
      return `\n\`\`\`\n${code}\n\`\`\`\n`;
    }
    return `\`${code}\``;
  }

  // Tables - convert to markdown-ish format
  if (tag === "table") {
    return convertTableToText(element);
  }

  // Lists
  if (tag === "li") {
    const content = element.childNodes.map((c) => htmlToText(c)).join("");
    return `• ${content}\n`;
  }

  // Paragraphs and divs
  if (tag === "p" || tag === "div") {
    const content = element.childNodes.map((c) => htmlToText(c)).join("");
    return content ? `${content}\n\n` : "";
  }

  // Headers - add markdown-style markers
  if (/^h[1-6]$/.test(tag)) {
    const level = Number.parseInt(tag[1], 10);
    const prefix = "#".repeat(level);
    const content = element.childNodes.map((c) => htmlToText(c)).join("");
    return `\n${prefix} ${content}\n\n`;
  }

  // Default: recurse into children
  return element.childNodes.map((c) => htmlToText(c)).join("");
}

interface Section {
  headerPath: string[];
  content: string;
  contentType: "text" | "code" | "table" | "mixed";
}

function updateSectionContentType(section: Section, tag: string): void {
  if (tag === "pre" || tag === "code") {
    if (section.contentType === "text") {
      section.contentType = "code";
    } else if (section.contentType !== "code") {
      section.contentType = "mixed";
    }
  } else if (tag === "table") {
    if (section.contentType === "text") {
      section.contentType = "table";
    } else if (section.contentType !== "table") {
      section.contentType = "mixed";
    }
  }
}

/**
 * Split HTML content into sections by headers
 */
function splitByHeaders(html: string): Section[] {
  const root = parse(html);
  const sections: Section[] = [];
  let currentSection: Section = {
    headerPath: [],
    content: "",
    contentType: "text",
  };
  const headerStack: string[] = [];

  function processNode(node: Node) {
    if (node.nodeType !== NodeType.ELEMENT_NODE) {
      if (node.nodeType === NodeType.TEXT_NODE && node.text.trim()) {
        currentSection.content += node.text;
      }
      return;
    }

    const element = node as HTMLElement;
    const tag = element.tagName?.toLowerCase();

    // Check if it's a header
    if (tag && /^h[1-6]$/.test(tag)) {
      // Save current section if it has content
      if (currentSection.content.trim()) {
        sections.push({ ...currentSection });
      }

      const level = Number.parseInt(tag[1], 10);
      const headerText = element.text.trim();

      // Update header stack
      while (headerStack.length >= level) {
        headerStack.pop();
      }
      headerStack.push(headerText);

      // Start new section
      currentSection = {
        headerPath: [...headerStack],
        content: "",
        contentType: "text",
      };
      return;
    }

    // Detect content type
    updateSectionContentType(currentSection, tag);

    // Add content
    currentSection.content += htmlToText(element);
  }

  // Process all top-level children
  for (const child of root.childNodes) {
    processNode(child);
  }

  // Don't forget the last section
  if (currentSection.content.trim()) {
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Get overlap text from the end of content
 */
function getOverlapText(content: string, overlapTokens: number): string {
  const targetChars = overlapTokens * 4;
  if (content.length <= targetChars) {
    return content;
  }

  // Try to break at a sentence or word boundary
  const overlapStart = content.length - targetChars;
  const text = content.slice(overlapStart);

  // Find first sentence or word boundary
  const sentenceMatch = /^[^.!?]*[.!?]\s*/.exec(text);
  if (sentenceMatch) {
    return text.slice(sentenceMatch[0].length);
  }

  const wordMatch = /^\S*\s+/.exec(text);
  if (wordMatch) {
    return text.slice(wordMatch[0].length);
  }

  return text;
}

/**
 * Split a section into smaller chunks if needed
 */
function splitSection(
  section: Section,
  options: ChunkingOptions
): Section[] {
  const tokens = estimateTokens(section.content);

  if (tokens <= options.maxTokens) {
    return [section];
  }

  // Split by paragraphs first
  const paragraphs = section.content.split(/\n\n+/);
  const chunks: Section[] = [];
  let currentChunk = "";
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (currentTokens + paraTokens > options.maxTokens && currentChunk) {
      chunks.push({
        ...section,
        content: currentChunk.trim(),
      });

      // Start new chunk with overlap
      const overlapText = getOverlapText(currentChunk, options.overlapTokens);
      currentChunk = overlapText + para + "\n\n";
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += para + "\n\n";
      currentTokens += paraTokens;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      ...section,
      content: currentChunk.trim(),
    });
  }

  return chunks;
}

/**
 * Main chunking function
 */
export function chunkHtmlContent(
  html: string,
  pageMetadata: PageMetadata,
  options: ChunkingOptions
): Chunk[] {
  // Split by headers first
  const sections = splitByHeaders(html);

  // Split large sections
  const allSections: Section[] = [];
  for (const section of sections) {
    allSections.push(...splitSection(section, options));
  }

  // Handle empty content
  if (allSections.length === 0) {
    return [];
  }

  // Convert to chunks with metadata
  const chunks: Chunk[] = allSections.map((section, index) => {
    // Build context prefix
    const contextParts = [
      `Page: ${pageMetadata.title}`,
      pageMetadata.ancestors.length > 0
        ? `Path: ${pageMetadata.ancestors.join(" > ")}`
        : null,
      section.headerPath.length > 0
        ? `Section: ${section.headerPath.join(" > ")}`
        : null,
    ].filter(Boolean);

    const contextPrefix = contextParts.join("\n") + "\n\n";

    return {
      id: `${pageMetadata.pageId}_${index}`,
      content: contextPrefix + section.content.trim(),
      metadata: {
        ...pageMetadata,
        chunkIndex: index,
        totalChunks: allSections.length,
        headerPath: section.headerPath,
        contentType: section.contentType,
      } as ChunkMetadata,
    };
  });

  return chunks;
}
