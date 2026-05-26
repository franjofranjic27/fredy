import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/", "/e2e/"],
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
  },
  collectCoverageFrom: [
    "**/*.(t|j)s",
    "!**/*.d.ts",
    "!**/*.module.ts",
    "!**/main.ts",
    "!**/cli.ts",
    "!**/config/configuration.ts",
    "!**/entry-points/**/bootstrap.ts",
    "!**/e2e/**",
  ],
  coveragePathIgnorePatterns: ["/node_modules/", "/e2e/"],
  coverageDirectory: "../coverage",
  coverageReporters: ["text", "lcov"],
  testEnvironment: "node",
};

export default config;
