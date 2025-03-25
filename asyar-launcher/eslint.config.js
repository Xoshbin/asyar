import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import * as tsPlugin from "@typescript-eslint/eslint-plugin";
import svelteParser from "svelte-eslint-parser";
import sveltePlugin from "eslint-plugin-svelte3";
// No need to import standard directly
// import standard from "eslint-config-standard"; // REMOVE THIS
import globals from "globals";

export default defineConfig([
  {
    files: ["**/*.{js,ts,svelte,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: 2021,
        project: "./tsconfig.json",
        extraFileExtensions: [".svelte"],
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      svelte3: sveltePlugin,
    },
    extends: [
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:@typescript-eslint/recommended-requiring-type-checking",
      "standard", // SIMPLIFIED: Just use the string "standard"
    ],
    rules: {
      // Customize as needed:
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
    overrides: [
      {
        files: ["*.svelte"],
        processor: "svelte3/svelte3",
        languageOptions: {
          parser: svelteParser,
          parserOptions: {
            parser: tsParser,
          },
        },
        rules: {
            "svelte3/valid-compile": ["warn", { ignoreWarnings: false }],
            'no-inner-declarations': 'off',
        }
      },
    ],
  },
]);