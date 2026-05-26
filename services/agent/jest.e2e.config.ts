import type { Config } from "jest";

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src/e2e",
  testRegex: ".*\\.e2e-spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "<rootDir>/../../tsconfig.json" }],
  },
  testEnvironment: "node",
};

export default config;
