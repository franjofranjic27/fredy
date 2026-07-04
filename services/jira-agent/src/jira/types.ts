export interface JiraUser {
  readonly accountId: string;
  readonly displayName: string;
}

export interface JiraIssue {
  readonly key: string;
  readonly summary: string;
  /** Plain text, normalised from the ADF description document. */
  readonly description: string;
  readonly reporter?: JiraUser;
  readonly assignee?: JiraUser;
  readonly status: { readonly name: string; readonly category: string };
  readonly issueType: string;
  readonly labels: readonly string[];
  readonly created: string;
  readonly updated: string;
}

export interface JiraComment {
  readonly id: string;
  readonly author: JiraUser;
  /** Plain text, normalised from the ADF comment body. */
  readonly body: string;
  readonly created: string;
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
}

/** Minimal ADF shapes — only what reading and writing comments needs. */
export interface AdfNode {
  readonly type?: string;
  readonly text?: string;
  readonly content?: readonly AdfNode[];
  readonly attrs?: Record<string, unknown>;
  readonly marks?: readonly Record<string, unknown>[];
}

export interface AdfDocument {
  readonly type: "doc";
  readonly version: 1;
  readonly content: readonly AdfNode[];
}

const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "codeBlock",
  "blockquote",
  "tableRow",
]);

/**
 * Flattens an ADF document to plain text. Block nodes end with a newline so
 * paragraphs stay separated; everything else concatenates its text children.
 */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "hardBreak") return "\n";
  const own = node.type === "text" && node.text ? node.text : "";
  const children = (node.content ?? []).map(adfToText).join("");
  const text = own + children;
  return node.type && BLOCK_NODE_TYPES.has(node.type) ? `${text}\n` : text;
}

/** adfToText plus whitespace cleanup for storing/prompting. */
export function adfToPlainText(node: AdfNode | null | undefined): string {
  return adfToText(node)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
