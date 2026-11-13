import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * PR description check, modeled on Crest's `check-contribution.py`.
 *
 * CI enforces only two things:
 *   1. `## What changed` has a real description (not the untouched template).
 *   2. `## AI usage` keeps both boxes, and ticking "AI tools helped" requires
 *      ticking the `asyar-contribution` skill box too.
 *
 * Every other template section (Affected areas, Manual smoke test, Boundaries)
 * is a guide for the author and the reviewer, not a CI gate.
 */

const EXEMPT_BOTS = new Set(['dependabot[bot]', 'renovate[bot]', 'github-actions[bot]']);

/**
 * Extract the markdown body under a level-2 heading (`## Heading`).
 *
 * @param {string} body
 * @param {string} heading
 * @returns {string | null}
 */
function extractSection(body, heading) {
  const lines = body.split(/\r?\n/);
  const target = heading.toLowerCase();
  let startIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^##\s+(.+?)\s*$/);
    if (match && match[1].toLowerCase() === target) {
      startIndex = i + 1;
      break;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  for (let i = startIndex; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      endIndex = i;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

/**
 * Strip HTML comments from markdown text.
 *
 * @param {string} text
 * @returns {string}
 */
function stripHtmlComments(text) {
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<!--[\s\S]*?-->/g, '');
  } while (current !== previous);
  return current;
}

/**
 * Parse markdown task-list checkboxes (`- [ ]` / `- [x]`) in a section.
 *
 * @param {string} section
 * @returns {Array<{ checked: boolean, label: string }>}
 */
function parseCheckboxes(section) {
  const checkboxes = [];
  const pattern = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm;
  for (const match of section.matchAll(pattern)) {
    checkboxes.push({
      checked: match[1].toLowerCase() === 'x',
      label: match[2].trim(),
    });
  }
  return checkboxes;
}

/**
 * Validate a pull request body against Asyar's contribution policy.
 *
 * @param {{ body?: string, author?: string, exemptLogins?: string[] }} input
 * @returns {{ ok: boolean, skipped?: string, errors: string[] }}
 */
export function validatePullRequestBody({ body = '', author = '', exemptLogins = [] }) {
  if (EXEMPT_BOTS.has(author)) {
    return { ok: true, skipped: `Exempt bot author: ${author}`, errors: [] };
  }

  const normalizedAuthor = author.trim().toLowerCase();
  if (
    normalizedAuthor &&
    exemptLogins.some((login) => login.trim().toLowerCase() === normalizedAuthor)
  ) {
    return { ok: true, skipped: `Exempt author: ${author}`, errors: [] };
  }

  const errors = [];
  const normalizedBody = body.replace(/\r\n/g, '\n');

  // 1. What changed: a real description, not the untouched template.
  const whatChanged = extractSection(normalizedBody, 'What changed');
  if (whatChanged === null) {
    errors.push(
      'The description is missing the `## What changed` section from the pull request template.',
    );
  } else {
    const cleaned = stripHtmlComments(whatChanged)
      .replace(/^\s*[-*]\s+\*\*(Before|After)[^*]*?\*\*:?\s*$/gim, '')
      .trim();
    if (cleaned.length < 15) {
      errors.push(
        '`## What changed` is empty. Briefly describe the change from the user’s or extension developer’s point of view (Before → After).',
      );
    }
  }

  // 2. AI usage: Crest-style two-box rule.
  const aiUsage = extractSection(normalizedBody, 'AI usage');
  const boxes = aiUsage === null ? [] : parseCheckboxes(aiUsage);
  const aiHelped = boxes.find((box) => /AI tools helped/i.test(box.label));
  const skillRan = boxes.find((box) => /asyar-contribution/i.test(box.label));
  if (!aiHelped || !skillRan) {
    errors.push(
      'The description is missing the `## AI usage` section from the pull request template. Restore both checkboxes, then tick the ones that apply (leave both empty if no AI tool was used).',
    );
  } else if (aiHelped.checked && !skillRan.checked) {
    errors.push(
      'AI tools helped produce this change, so the `asyar-contribution` skill must be run and its box ticked. See `.agents/skills/asyar-contribution/SKILL.md`.',
    );
  }

  return { ok: errors.length === 0, errors };
}

function parseArgs(argv) {
  const args = { eventPath: null, bodyFile: null, exemptLogins: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--event' && argv[i + 1]) {
      args.eventPath = argv[++i];
    } else if (arg === '--body-file' && argv[i + 1]) {
      args.bodyFile = argv[++i];
    } else if (arg === '--exempt-login' && argv[i + 1]) {
      args.exemptLogins.push(argv[++i]);
    }
  }
  return args;
}

function main() {
  const { eventPath, bodyFile, exemptLogins } = parseArgs(process.argv.slice(2));
  let body = '';
  let author = '';

  if (eventPath) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    body = event.pull_request?.body ?? '';
    author = event.pull_request?.user?.login ?? '';
  } else if (bodyFile) {
    body = readFileSync(bodyFile, 'utf8');
  } else {
    console.error(
      'Usage: node scripts/check-pr.mjs [--event <path> | --body-file <path>] [--exempt-login <login>]',
    );
    process.exit(2);
  }

  const result = validatePullRequestBody({ body, author, exemptLogins });
  if (result.ok) {
    const suffix = result.skipped ? ` (${result.skipped})` : '';
    console.log(`PR description check passed${suffix}.`);
    process.exit(0);
  }

  console.error('PR description check failed:\n');
  for (const error of result.errors) {
    console.error(`  - ${error}`);
  }
  console.error(
    '\nTip: Use `.github/PULL_REQUEST_TEMPLATE.md` or run the `.agents/skills/asyar-contribution/SKILL.md` skill to generate a valid PR description.',
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
