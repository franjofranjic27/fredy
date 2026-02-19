import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["**/node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.test.ts",
        "src/index.ts",
        "src/**/types.ts",
        "src/chunking/index.ts",
        "src/confluence/index.ts",
        "src/pipeline/index.ts",
        "src/qdrant/index.ts",
        "src/local/index.ts",
      ],
      reportsDirectory: "./coverage",
    },
  },
});
