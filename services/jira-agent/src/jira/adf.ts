import type { AdfDocument, AdfNode } from "./types.js";

interface MutableAdfNode {
  type: string;
  text?: string;
  content?: MutableAdfNode[];
  attrs?: Record<string, unknown>;
  marks?: Record<string, unknown>[];
}

const INLINE_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

function inlineNodes(text: string): MutableAdfNode[] {
  const nodes: MutableAdfNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push({ type: "text", text: text.slice(lastIndex, index) });
    if (match[1] !== undefined && match[2] !== undefined) {
      nodes.push({
        type: "text",
        text: match[1],
        marks: [{ type: "link", attrs: { href: match[2] } }],
      });
    } else if (match[3] !== undefined) {
      nodes.push({ type: "text", text: match[3], marks: [{ type: "strong" }] });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push({ type: "text", text: text.slice(lastIndex) });
  // ADF rejects empty text nodes; an empty paragraph content array is valid.
  return nodes.filter((node) => node.text !== "");
}

function paragraph(text: string): MutableAdfNode {
  return { type: "paragraph", content: inlineNodes(text) };
}

function bulletList(lines: string[]): MutableAdfNode {
  return {
    type: "bulletList",
    content: lines.map((line) => ({
      type: "listItem",
      content: [paragraph(line.replace(/^-\s+/, ""))],
    })),
  };
}

function codeBlock(lines: string[]): MutableAdfNode {
  const text = lines.join("\n");
  // Empty fences must not produce an empty text node (Jira rejects those).
  return text === ""
    ? { type: "codeBlock" }
    : { type: "codeBlock", content: [{ type: "text", text }] };
}

function convert(markdown: string): MutableAdfNode[] {
  const blocks: MutableAdfNode[] = [];
  const lines = markdown.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push(codeBlock(code));
      continue;
    }
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        items.push(lines[index]);
        index += 1;
      }
      blocks.push(bulletList(items));
      continue;
    }
    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !/^-\s+/.test(lines[index]) &&
      !lines[index].trimStart().startsWith("```")
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(paragraph(paragraphLines.join(" ")));
  }
  return blocks.length > 0 ? blocks : [{ type: "paragraph", content: [] }];
}

/**
 * Minimal markdown→ADF for agent comments (paragraphs, "- " lists, fenced
 * code, [links](url), **bold**). Jira Cloud v3 comments require ADF. Any
 * conversion failure falls back to plain-text paragraphs — a slightly ugly
 * comment beats a lost one.
 */
export function markdownToAdf(markdown: string): AdfDocument {
  try {
    return { type: "doc", version: 1, content: convert(markdown) as unknown as AdfNode[] };
  } catch {
    const content = markdown
      .split(/\n{2,}/)
      .filter((block) => block.trim() !== "")
      .map((block) => ({
        type: "paragraph",
        content: [{ type: "text", text: block }],
      }));
    return {
      type: "doc",
      version: 1,
      content: (content.length > 0 ? content : [{ type: "paragraph", content: [] }]) as AdfNode[],
    };
  }
}
