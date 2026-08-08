#!/usr/bin/env node
/**
 * Design-system checker.
 *
 * Enforces the rules in `.agents/skills/design-language/SKILL.md` against the
 * launcher source. Every rule here exists because the codebase drifted at that
 * exact point at least once — this is the machine-readable half of the design
 * language, and the skill file is the half a human or an agent reads.
 *
 * Escape hatch: put `design-ok: <reason>` in a comment on the offending line
 * or the line directly above it. A reason is required — a bare `design-ok`
 * does not suppress. Use it for the genuine exceptions (a standalone webview
 * with no theme injection, a value pinned to a native platform metric), not to
 * quiet a rule you disagree with.
 *
 * Cross-platform (Node.js, no bash dependencies).
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const SRC = resolve(root, 'asyar-launcher/src');
const TOKENS_FILE = resolve(SRC, 'resources/styles/style.css');
const BARREL = resolve(SRC, 'components/index.ts');

/* ── File discovery ─────────────────────────────────────────────────────── */

const SKIP_DIRS = new Set(['node_modules', 'build', '.svelte-kit', 'dist', 'coverage']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(svelte|css)$/.test(entry)) out.push(full);
  }
  return out;
}

/* ── Known-good token set ───────────────────────────────────────────────── */

const tokensCss = readFileSync(TOKENS_FILE, 'utf8');
const DEFINED_TOKENS = new Set(
  [...tokensCss.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);

/**
 * Components that are intentionally absent from the barrel, with the reason.
 * Keep this in sync with the comment at the bottom of components/index.ts.
 */
const BARREL_EXEMPT = new Map([
  ['base/ConfirmDialog.svelte', 'mount via DialogHost, or import the file directly'],
  // Feedback presenters: only approved composition hosts may mount these.
  // Enforced by services/feedback/feedbackBoundary.test.ts.
  ['feedback/ToastHost.svelte', 'feedback presenter — publish via feedbackService'],
  ['feedback/FatalErrorDialog.svelte', 'feedback presenter — publish via feedbackService'],
  ['feedback/FeedbackDetailsDialog.svelte', 'feedback presenter — publish via feedbackService'],
  ['layout/FeedbackBar.svelte', 'feedback presenter — publish via feedbackService'],
  ['dev/ExtensionNav.svelte', 'internal to InspectorShell'],
  ['dev/HelpPanel.svelte', 'internal to InspectorShell'],
  ['dev/JsonTree.svelte', 'internal to InspectorShell'],
  ['dev/PanelEvents.svelte', 'internal to InspectorShell'],
  ['dev/PanelIpc.svelte', 'internal to InspectorShell'],
  ['dev/PanelRpc.svelte', 'internal to InspectorShell'],
  ['dev/PanelRuntime.svelte', 'internal to InspectorShell'],
  ['dev/PanelState.svelte', 'internal to InspectorShell'],
  ['dev/PanelSubscriptions.svelte', 'internal to InspectorShell'],
  ['dev/StreamTail.svelte', 'internal to InspectorShell'],
  ['dev/TimestampRelative.svelte', 'internal to InspectorShell'],
]);

/* ── Rules ──────────────────────────────────────────────────────────────── */

/** Properties whose values must come off a scale. */
const SCALED_PROPS =
  'font-size|padding|padding-[a-z]+|margin|margin-[a-z]+|gap|row-gap|column-gap|border-radius';

const TAILWIND_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/;

const LINE_RULES = [
  {
    id: 'token-fallback',
    test: (line) => /var\(\s*--[a-z0-9-]+\s*,/.exec(line),
    message: 'var() fallback — every token is always defined, so a fallback only hides a typo',
    fix: 'Drop the fallback: var(--token). If the token does not exist, add it to style.css.',
  },
  {
    id: 'hardcoded-color',
    test: (line) =>
      /^\s*(?:color|background|background-color|border-color|border(?:-top|-right|-bottom|-left)?-color|fill|stroke|outline-color|caret-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|\bwhite\b|\bblack\b)/.exec(
        line,
      ),
    message: 'hardcoded colour',
    fix: 'Use a colour token. Text on a filled surface is var(--text-on-accent); a code colour is var(--syntax-*).',
  },
  {
    id: 'tailwind-palette',
    test: (line) => TAILWIND_PALETTE.exec(line),
    message: "Tailwind palette class — the app's colours are not Tailwind's",
    fix: 'Use bg-[var(--token)] / text-[var(--token)], or move the rule into the <style> block.',
  },
  {
    id: 'raw-px',
    // px inside calc() is an intentional adjustment to a token, not a bypass
    // of the scale — `calc(var(--radius-sm) - 2px)` is fine.
    test: (line) =>
      new RegExp(`^\\s*(?:${SCALED_PROPS})\\s*:[^;]*?\\b\\d+px`).exec(
        line.replace(/calc\((?:[^()]|\([^()]*\))*\)/g, 'calc()'),
      ),
    message: 'raw pixel value on a scaled property',
    fix: 'Use var(--space-*), var(--font-size-*) or var(--radius-*). Fixed structural width/height may stay in px.',
  },
  {
    id: 'arbitrary-px',
    test: (line) => /\b[a-z-]+-\[\d+(?:\.\d+)?(?:px|rem)\]/.exec(line),
    message: 'Tailwind arbitrary pixel value',
    fix: 'Use a token: e.g. min-h-[var(--shell-header-h)], text-[length:var(--font-size-2xs)].',
  },
  {
    id: 'bare-z-index',
    test: (line) => /(?:z-index\s*:\s*\d|\bz-\[?\d+\]?(?:\s|"|'|$))/.exec(line),
    message: 'bare z-index',
    fix: 'Use the stacking scale: var(--z-base|raised|footer|dropdown|floating|header|overlay|portal).',
  },
  {
    id: 'stale-a11y-ignore',
    test: (line) => /svelte-ignore\s+a11y-/.exec(line),
    message:
      'Svelte 4 a11y rule name — Svelte 5 renamed these to underscores, so this suppresses nothing',
    fix: 'Rename e.g. a11y-no-static-element-interactions → a11y_no_static_element_interactions.',
  },
];

/* ── Runner ─────────────────────────────────────────────────────────────── */

const findings = [];

function record(file, line, rule, detail) {
  findings.push({ file: relative(root, file), line, rule, detail });
}

/** `design-ok: <reason>` on this line or the one above suppresses a finding. */
function suppressed(lines, i) {
  const here = lines[i] ?? '';
  const above = lines[i - 1] ?? '';
  return /design-ok:\s*\S/.test(here) || /design-ok:\s*\S/.test(above);
}

const files = walk(SRC);

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  // A whole file can be exempt — `design-ok-file: <reason>` anywhere in it.
  // The launcher HUD is the real case: a standalone Tauri webview with no
  // theme injection, where a var() would resolve to nothing.
  if (/design-ok-file:\s*\S/.test(text)) continue;

  // Per-line rules
  lines.forEach((line, i) => {
    if (suppressed(lines, i)) return;
    for (const rule of LINE_RULES) {
      // style.css defines the scales, so it is allowed to contain raw values.
      if (file === TOKENS_FILE && ['raw-px', 'hardcoded-color', 'bare-z-index'].includes(rule.id)) {
        continue;
      }
      const hit = rule.test(line);
      if (hit) record(file, i + 1, rule, line.trim().slice(0, 100));
    }
  });

  // Undefined token references. A token counts as defined if it is in
  // style.css, set locally in this file, or bound inline via style:--x={...}.
  const localDefs = new Set([
    // `--x: value` in a <style> block, or inside a style="…" attribute
    ...[...text.matchAll(/(?:^|[\s;{"'])(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    // Svelte's `style:--x={…}` directive
    ...[...text.matchAll(/style:(--[a-z0-9-]+)/g)].map((m) => m[1]),
  ]);
  lines.forEach((line, i) => {
    if (suppressed(lines, i)) return;
    for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      const token = m[1];
      if (DEFINED_TOKENS.has(token) || localDefs.has(token)) continue;
      record(
        file,
        i + 1,
        {
          id: 'undefined-token',
          message: `var(${token}) is not defined anywhere`,
          fix: 'Add the token to style.css, or point at an existing one. An undefined var() makes the whole declaration invalid.',
        },
        line.trim().slice(0, 100),
      );
    }
  });

  // Scrollable containers must carry .custom-scrollbar.
  // style.css is where .custom-scrollbar itself is defined, so the counting
  // heuristic does not apply to it.
  const scrollCount =
    file === TOKENS_FILE
      ? 0
      : (text.match(/overflow-y-auto|overflow-y:\s*auto|overflow:\s*auto/g) || []).length;
  const barCount = (text.match(/custom-scrollbar/g) || []).length;
  if (scrollCount > barCount && !/design-ok:/.test(text)) {
    record(
      file,
      1,
      {
        id: 'missing-scrollbar',
        message: `${scrollCount} scrollable container(s) but ${barCount} .custom-scrollbar`,
        fix: 'Add class="… custom-scrollbar" to the scrolling element.',
      },
      '',
    );
  }
}

// Every component must be reachable from the barrel.
const barrelText = readFileSync(BARREL, 'utf8');
for (const file of files) {
  const rel = relative(resolve(SRC, 'components'), file);
  if (rel.startsWith('..') || !file.endsWith('.svelte')) continue;
  const key = rel.split(/[\\/]/).join('/');
  if (BARREL_EXEMPT.has(key)) continue;
  if (barrelText.includes(`/${key}'`)) continue;
  record(
    file,
    1,
    {
      id: 'unexported-component',
      message: 'component is not exported from components/index.ts',
      fix: 'Add an export to the matching section of the barrel, or add it to BARREL_EXEMPT with a reason.',
    },
    '',
  );
}

/* ── Report ─────────────────────────────────────────────────────────────── */

if (findings.length === 0) {
  console.log(`✓ Design system: ${files.length} files clean`);
  process.exit(0);
}

const byRule = new Map();
for (const f of findings) {
  if (!byRule.has(f.rule.id)) byRule.set(f.rule.id, { rule: f.rule, items: [] });
  byRule.get(f.rule.id).items.push(f);
}

console.error(`\n✗ Design system: ${findings.length} violation(s) in ${files.length} files\n`);
for (const [id, { rule, items }] of [...byRule].sort(
  (a, b) => b[1].items.length - a[1].items.length,
)) {
  console.error(`  ${id} — ${rule.message} (${items.length})`);
  console.error(`  → ${rule.fix}`);
  for (const item of items.slice(0, 12)) {
    console.error(`      ${item.file}:${item.line}${item.detail ? `  ${item.detail}` : ''}`);
  }
  if (items.length > 12) console.error(`      … and ${items.length - 12} more`);
  console.error('');
}
console.error('Rules: .agents/skills/design-language/SKILL.md');
console.error('Genuine exception? Add a `design-ok: <reason>` comment on the line.\n');
process.exit(1);
