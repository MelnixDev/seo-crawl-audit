import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/bundle/**", "**/action-dist/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
    },
  },
  {
    files: ["packages/cli/src/**/*.ts", "packages/action/src/**/*.ts", "packages/mcp/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: [
            "@seo-crawl-audit/core/dist/**",
            "@seo-crawl-audit/core/src/**",
            "../../core/**",
          ],
          message: "Consumers must use the public core root or core/node subpath.",
        }],
      }],
    },
  },
  {
    files: [
      "packages/core/src/api.ts",
      "packages/core/src/planning.ts",
      "packages/core/src/audit.ts",
      "packages/core/src/compare.ts",
      "packages/core/src/rules/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["./node*", "../node*", "./file-checkpoint-store*", "../file-checkpoint-store*"],
          message: "Core application and rule layers cannot depend on Node file adapters.",
        }],
      }],
    },
  },
);
