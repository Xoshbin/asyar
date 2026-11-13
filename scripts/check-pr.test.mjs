import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validatePullRequestBody } from './check-pr.mjs';

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

## AI usage

- [ ] AI tools helped produce this change.
- [ ] I ran the \`asyar-contribution\` skill (\`.agents/skills/asyar-contribution/SKILL.md\`), followed it, and reviewed every generated line.

## Boundaries

- [x] Zero-hardcoded-strings i18n policy respected (if UI strings were added/changed).
- [x] Third-party extension compatibility preserved (no breaking changes to published extension contracts without deprecation/boundary adapter).
- [x] Hot paths remain fast and unblocked (window reveal, keystroke search, and 120 FPS UI responsiveness).
- [x] \`pnpm check:ci\` (or the relevant inner-loop checks) passes locally.
`;

const AI_BOTH_CHECKED = VALID_BODY.replace(
  '- [ ] AI tools helped produce this change.\n- [ ] I ran the `asyar-contribution`',
  '- [x] AI tools helped produce this change.\n- [x] I ran the `asyar-contribution`',
);

test('passes for a complete human-authored PR body', () => {
  const result = validatePullRequestBody({ body: VALID_BODY, author: 'contributor' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('passes when both AI usage boxes are checked', () => {
  const result = validatePullRequestBody({ body: AI_BOTH_CHECKED, author: 'contributor' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('fails when AI tools helped is checked without running the skill', () => {
  const body = VALID_BODY.replace(
    '- [ ] AI tools helped produce this change.',
    '- [x] AI tools helped produce this change.',
  );
  const result = validatePullRequestBody({ body, author: 'contributor' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('asyar-contribution')));
});

test('fails when the AI usage section is removed', () => {
  const body = VALID_BODY.replace(/## AI usage[\s\S]*?## Boundaries/, '## Boundaries');
  const result = validatePullRequestBody({ body, author: 'contributor' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('AI usage')));
});

test('fails on the unmodified PR template', () => {
  const template = readFileSync('.github/PULL_REQUEST_TEMPLATE.md', 'utf8');
  const result = validatePullRequestBody({ body: template, author: 'contributor' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('What changed')));
});

test('fails when Before/After placeholders are left empty', () => {
  const body = VALID_BODY.replace(
    /## What changed[\s\S]*?## Affected areas/,
    `## What changed

<!-- Describe the fix or feature in plain English from the user's or extension developer's POV. -->

- **Before (issue / current behavior):** <!-- How to reproduce or what happened previously -->
- **After (fix / new behavior):** <!-- What happens now and how to see it -->

## Affected areas`,
  );
  const result = validatePullRequestBody({ body, author: 'contributor' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('What changed')));
});

test('does not gate on unchecked smoke-test, affected-area, or boundary boxes', () => {
  const body = AI_BOTH_CHECKED.replace(/- \[x\] (?!AI tools|I ran)/g, '- [ ] ');
  const result = validatePullRequestBody({ body, author: 'contributor' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('passes PR #1044 shape: honest unchecked check:ci note and no smoke-test prose', () => {
  const body = AI_BOTH_CHECKED.replace(
    '- [x] `pnpm check:ci` (or the relevant inner-loop checks) passes locally.',
    '- [ ] `pnpm check:ci` (or the relevant inner-loop checks) passes locally. Everything passes except unrelated items.',
  );
  const result = validatePullRequestBody({ body, author: 'contributor' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('ignores the CodeRabbit summary appended at the bottom', () => {
  const body = `${AI_BOTH_CHECKED}\n## Summary by CodeRabbit\n\n- **New Features**\n  - Something.\n`;
  const result = validatePullRequestBody({ body, author: 'contributor' });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('exempts bot authors', () => {
  const result = validatePullRequestBody({ body: 'Bump dependency', author: 'dependabot[bot]' });
  assert.equal(result.ok, true);
  assert.ok(result.skipped?.includes('dependabot[bot]'));
});

test('exempts repository owner when passed in exemptLogins (case-insensitive)', () => {
  const result = validatePullRequestBody({
    body: 'Quick fix',
    author: 'xoshbin',
    exemptLogins: ['Xoshbin'],
  });
  assert.equal(result.ok, true);
  assert.ok(result.skipped?.includes('Exempt author'));
});
