import { describe, expect, it } from "vitest";
import { markdownToAdf } from "./adf.js";
import { adfToPlainText } from "./types.js";

describe("markdownToAdf", () => {
  it("converts plain paragraphs", () => {
    const doc = markdownToAdf("First paragraph.\n\nSecond paragraph.");
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(2);
    expect(doc.content[0].type).toBe("paragraph");
    expect(adfToPlainText(doc)).toContain("First paragraph.");
    expect(adfToPlainText(doc)).toContain("Second paragraph.");
  });

  it("converts dash lists into bulletList nodes", () => {
    const doc = markdownToAdf("Intro:\n\n- first item\n- second item");
    const list = doc.content[1];
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(2);
    expect(list.content?.[0].type).toBe("listItem");
    expect(adfToPlainText(doc)).toContain("first item");
  });

  it("converts fenced code blocks", () => {
    const doc = markdownToAdf("Run this:\n\n```\nsudo systemctl restart vpn\n```");
    const code = doc.content[1];
    expect(code.type).toBe("codeBlock");
    expect(code.content?.[0].text).toBe("sudo systemctl restart vpn");
  });

  it("converts links and bold to marked text nodes", () => {
    const doc = markdownToAdf("See [the guide](https://wiki/vpn) for **details**.");
    const paragraph = doc.content[0];
    const linkNode = paragraph.content?.find((node) =>
      node.marks?.some((mark) => mark.type === "link"),
    );
    const boldNode = paragraph.content?.find((node) =>
      node.marks?.some((mark) => mark.type === "strong"),
    );
    expect(linkNode?.text).toBe("the guide");
    expect(linkNode?.marks?.[0].attrs).toEqual({ href: "https://wiki/vpn" });
    expect(boldNode?.text).toBe("details");
  });

  it("keeps the clarification marker intact through a text round-trip", () => {
    const doc = markdownToAdf("Please add details.\n\n[fredy:clarification]");
    expect(adfToPlainText(doc)).toContain("[fredy:clarification]");
  });

  it("produces a paragraph for empty input", () => {
    const doc = markdownToAdf("");
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe("paragraph");
  });
});
