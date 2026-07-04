import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineConfig } from "./define-config.js";

describe("defineConfig", () => {
  const schema = z.object({
    PORT: z.coerce.number().default(8001),
    NAME: z.string(),
  });

  it("parses a valid environment", () => {
    const config = defineConfig(schema, { PORT: "9000", NAME: "fredy" });
    expect(config).toEqual({ PORT: 9000, NAME: "fredy" });
  });

  it("applies defaults", () => {
    const config = defineConfig(schema, { NAME: "fredy" });
    expect(config.PORT).toBe(8001);
  });

  it("fails fast with a readable error listing every violation", () => {
    expect(() => defineConfig(schema, { PORT: "abc" })).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => defineConfig(schema, { PORT: "abc" })).toThrow(/PORT/);
    expect(() => defineConfig(schema, { PORT: "abc" })).toThrow(/NAME/);
  });
});
