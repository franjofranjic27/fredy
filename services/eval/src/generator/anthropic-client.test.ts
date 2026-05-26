import { describe, expect, it } from "vitest";
import { parseJsonLenient, parseQuestionJson } from "./anthropic-client.js";

describe("parseJsonLenient", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips ```json fences", () => {
    const raw = '```json\n{"a":1}\n```';
    expect(parseJsonLenient(raw)).toEqual({ a: 1 });
  });

  it("strips bare ``` fences", () => {
    const raw = '```\n{"a":1}\n```';
    expect(parseJsonLenient(raw)).toEqual({ a: 1 });
  });

  it("extracts the first object when surrounded by prose", () => {
    const raw = 'Sure! Here is your JSON: {"a":1} hope that helps.';
    expect(parseJsonLenient(raw)).toEqual({ a: 1 });
  });

  it("throws if no JSON object is present", () => {
    expect(() => parseJsonLenient("nothing here")).toThrow();
  });
});

describe("parseQuestionJson", () => {
  it("parses a well-formed response", () => {
    const result = parseQuestionJson('{"question":"Wie?", "rationale":"weil"}');
    expect(result).toEqual({ question: "Wie?", rationale: "weil" });
  });

  it("tolerates fenced output", () => {
    const result = parseQuestionJson('```json\n{"question":"Wie?","rationale":"weil"}\n```');
    expect(result.question).toBe("Wie?");
  });

  it("trims whitespace from fields", () => {
    const result = parseQuestionJson('{"question":"  Wie?  ","rationale":"  weil  "}');
    expect(result.question).toBe("Wie?");
    expect(result.rationale).toBe("weil");
  });

  it("rejects missing question", () => {
    expect(() => parseQuestionJson('{"rationale":"weil"}')).toThrow(/question/);
  });

  it("rejects empty question", () => {
    expect(() => parseQuestionJson('{"question":"   ","rationale":"weil"}')).toThrow(/question/);
  });

  it("rejects missing rationale", () => {
    expect(() => parseQuestionJson('{"question":"Wie?"}')).toThrow(/rationale/);
  });
});
