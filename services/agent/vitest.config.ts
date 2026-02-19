import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/e2e/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.ts",
        "src/index.ts",
        "src/**/types.ts",
        "src/llm/index.ts",
        "src/tools/index.ts",
        "src/session/index.ts",
      ],
      reportsDirectory: "./coverage",
    },
  },
});
