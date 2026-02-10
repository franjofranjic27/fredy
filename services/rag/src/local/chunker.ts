/**
 * Convert local file content to HTML so the existing chunkHtmlContent() can process it.
 */
export function localFileToHtml(content: string, extension: string): string {
  switch (extension.toLowerCase()) {
    case ".html":
      return content;

    case ".md":
      return markdownToHtml(content);

    case ".txt":
      return textToHtml(content);

    default:
      return textToHtml(content);
  }
}

/**
 * Lightweight markdown-to-HTML conversion.
 * Handles headers, paragraphs, code blocks, and blank-line separation.
 */
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const htmlParts: string[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (const line of lines) {
    // Fenced code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        htmlParts.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      htmlParts.push(`<h${level}>${escapeHtml(headerMatch[2])}</h${level}>`);
      continue;
    }

    // Blank lines
    if (line.trim() === "") {
      continue;
    }

    // Regular paragraph
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
  }

  // Close unclosed code block
  if (inCodeBlock && codeBuffer.length > 0) {
    htmlParts.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
  }

  return htmlParts.join("\n");
}

/**
 * Wrap plain text in <p> tags, splitting on blank lines.
 */
function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
