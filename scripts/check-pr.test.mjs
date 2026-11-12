import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDocsOrLocaleFile, validatePullRequestBody } from './check-pr.mjs';

const VALID_BODY = `## What changed

- **Before (issue / current behavior):** Pressing Escape while a sub-view was open closed the entire launcher window.
- **After (fix / new behavior):** Pressing Escape in a sub-view pops back to the main search bar; pressing Escape on the main search bar closes the window.

## Affected areas

- [x] Launcher UI / UX (visuals, interactions, keyboard shortcuts, settings)
- [ ] SDK / Extensions (\`asyar-sdk\`, extension runtime, IPC contracts, manifest)
- [ ] Rust Backend / Platform (Tauri commands, search, storage, OS integration)
- [ ] Docs / Tooling / Other (docs, CI, build scripts, locales)

## Manual smoke test & Validation

- [x] I manually smoke-tested this in the running app (\`pnpm dev\`) and visually verified the fix/feature works.

Opened Calculator view in \`pnpm dev\`, pressed Escape, and verified it returned to the search bar with focus intact. Ran \`pnpm check:ci\`.

## AI usage

- [ ] AI tools helped produce this change.
- [ ] I ran the \`asyar-contribution\` skill (\`.agents/skills/asyar-contribution/SKILL.md\`), followed it, and reviewed every generated line.

## Boundaries

- [x] Zero-hardcoded-strings i18n policy respected (if UI strings were added/changed).
- [x] Third-party extension compatibility preserved (no breaking changes to published extension contracts without deprecation/boundary adapter).
- [x] Hot paths remain fast and unblocked (window reveal, keystroke search, and 120 FPS UI responsiveness).
- [x] \`pnpm check:ci\` (or the relevant inner-loop checks) passes locally.
`;

test('passes for a complete human-authored PR body', () => {
  const result = validatePullRequestBody({
    body: VALID_BODY,
    author: 'contributor',
    changedFiles: ['asyar-launcher/src/App.svelte'],
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('passes when both AI usage boxes are checked', () => {
  const aiBody = VALID_BODY.replace(
    '- [ ] AI tools helped produce this change.\n- [ ] I ran the `asyar-contribution`',
    '- [x] AI tools helped produce this change.\n- [x] I ran the `asyar-contribution`',
  );
  const result = validatePullRequestBody({
    body: aiBody,
    author: 'contributor',
    changedFiles: ['asyar-launcher/src/App.svelte'],
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('fails when AI tools helped is checked without running the skill', () => {
  const partialAiBody = VALID_BODY.replace(
    '- [ ] AI tools helped produce this change.',
    '- [x] AI tools helped produce this change.',
  );
  const result = validatePullRequestBody({
    body: partialAiBody,
    author: 'contributor',
    changedFiles: ['asyar-launcher/src/App.svelte'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('asyar-contribution')));
});

test('fails on the unmodified PR template', () => {
  const template = readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8');
  const result = validatePullRequestBody({
    body: template,
    author: 'contributor',
    changedFiles: ['asyar-launcher/src/App.svelte'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4);
});

test('exempts bot authors', () => {
  const result = validatePullRequestBody({
    body: 'Bump dependency',
    author: 'dependabot[bot]',
    changedFiles: ['package.json'],
  });
  assert.equal(result.ok, true);
  assert.ok(result.skipped?.includes('dependabot[bot]'));
});

test('exempts docs-only and locale-only PRs from smoke test and boundaries', () => {
  const docsBody = `## What changed

Updated the extension quickstart guide with the new dev command.
`;
  const result = validatePullRequestBody({
    body: docsBody,
    author: 'contributor',
    changedFiles: ['docs/tutorials/quickstart.md', 'asyar-launcher/src/locales/en.json'],
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(isDocsOrLocaleFile('asyar-launcher/src/App.svelte'), false);
});

test('fails when Before/After placeholders are left empty even if other sections are filled', () => {
  const emptyWhatChanged = VALID_BODY.replace(
    /## What changed[\s\S]*?## Affected areas/,
    `## What changed

<!-- Describe the fix or feature in plain English from the user's or extension developer's POV. -->

- **Before (issue / current behavior):** <!-- How to reproduce or what happened previously -->
- **After (fix / new behavior):** <!-- What happens now and how to see it -->

## Affected areas`,
  );
  const result = validatePullRequestBody({
    body: emptyWhatChanged,
    author: 'contributor',
    changedFiles: ['asyar-launcher/src/App.svelte'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('What changed')));
});

test('enforces AI usage two-box rule on docs-only PRs', () => {
  const docsWithPartialAi = `## What changed

Updated the contributing guide with clearer formatting.

## AI usage

- [x] AI tools helped produce this change.
- [ ] I ran the \`asyar-contribution\` skill (\`.agents/skills/asyar-contribution/SKILL.md\`), followed it, and reviewed every generated line.
`;
  const result = validatePullRequestBody({
    body: docsWithPartialAi,
    author: 'contributor',
    changedFiles: ['CONTRIBUTING.md'],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('asyar-contribution')));
});
