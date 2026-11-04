import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-check/**",
      "**/.next-e2e/**",
      "test-results/**",
      "playwright-report/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "apps/server/src/database/migrations/**",
      "examples/**",
      "e2e/fixtures/**",
      "**/.data/**",
      "**/.vscode-test/**",
      "apps/vscode/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}", "apps/vscode/src/webview/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
