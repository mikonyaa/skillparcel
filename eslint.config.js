import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "fixtures/**",
      "examples/**",
      "site/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        TextDecoder: "readonly",
        AbortController: "readonly",
        fetch: "readonly",
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        globalThis: "readonly",
        performance: "readonly",
        structuredClone: "readonly",
        setImmediate: "readonly",
      },
    },
  },
  {
    files: ["**/*.mjs"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
);
