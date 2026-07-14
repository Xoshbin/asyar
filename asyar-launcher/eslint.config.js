import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import neostandard from 'neostandard';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import svelteConfig from './svelte.config.js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// eslint-config-standard (v17) is eslintrc-format and targets ESLint 8; it
// can't be extended by name under ESLint 9 flat config. neostandard is the
// standard/js team's own flat-config-native successor — same rule philosophy,
// built for this ESLint version. noStyle: true because Prettier (not ESLint)
// owns formatting here.
export default defineConfig([
  // Parser, plugin registration, and base rules for *.svelte files —
  // supersedes the old eslint-plugin-svelte3 processor, which isn't
  // available under eslint-plugin-svelte v3 (flat-config only).
  ...svelte.configs.recommended,
  js.configs.recommended,
  ...neostandard({ noStyle: true }),
  ...tseslint.configs.recommendedTypeChecked,
  {
    // No `files` scoping: applies everywhere (js, ts, and svelte alike), so
    // nothing here needs duplicating per file type.
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    rules: {
      // neostandard's no-void otherwise flags `void someAsyncCall();` —
      // the exact pattern @typescript-eslint/no-floating-promises itself
      // suggests for intentionally-ignored promises, and already used
      // throughout this codebase. Allow void as a statement; still catches
      // stray `void` in expression position.
      'no-void': ['error', { allowAsStatement: true }],
    },
  },
  {
    files: ['**/*.{js,ts,mjs,cjs}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Customize as needed:
      'no-unused-vars': 'warn',
      'no-undef': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // typescript-eslint's own base config (spread in above) sets
    // languageOptions.parser = tseslint.parser with no `files` scoping, so it
    // applies to *.svelte too and clobbers svelte.configs.recommended's
    // parser assignment. Reassert svelte-eslint-parser as the template
    // parser here; parserOptions.parser is the *inner* sub-parser it
    // delegates <script> block contents to.
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tseslint.parser,
        project: './tsconfig.json',
        extraFileExtensions: ['.svelte'],
        svelteConfig,
      },
    },
    rules: {
      'svelte/valid-compile': ['warn', { ignoreWarnings: false }],
      'no-inner-declarations': 'off',
    },
  },
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/services/notification/notificationService',
                '**/components/feedback/ToastHost.svelte',
                '**/components/feedback/FatalErrorDialog.svelte',
                '**/components/feedback/FeedbackDetailsDialog.svelte',
                '**/components/layout/FeedbackBar.svelte',
              ],
              message: 'Feedback children are private. Use feedbackService instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/services/feedback/**',
      'src/components/layout/BottomActionBar.svelte',
      'src/components/layout/FeedbackBar.svelte',
      'src/routes/+page.svelte',
      'src/services/notification/notificationService.test.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  // Must come last: turns off stylistic rules (quotes, semi, indent, ...)
  // that would otherwise fight Prettier, which now owns all formatting.
  prettier,
]);
