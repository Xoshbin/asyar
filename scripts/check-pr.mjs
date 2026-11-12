import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXEMPT_BOTS = new Set(['dependabot[bot]', 'renovate[bot]', 'github-actions[bot]']);

/**
 * Determine whether a changed file path is documentation-only or a locale catalog.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
export function isDocsOrLocaleFile(filePath) {
  const normalized = filePath.trim().replaceAll('\\', '/');
  if (!normalized) {
    return true;
  }
  return (
    normalized.startsWith('docs/') ||
    normalized.startsWith('asyar-launcher/src/locales/') ||
    normalized.endsWith('.md') ||
    normalized === 'LICENSE'
  );
}

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
 * Validate a pull request body against Asyar's contribution checklist.
 *
 * @param {{ body?: string, author?: string, changedFiles?: string[] }} input
 * @returns {{ ok: boolean, skipped?: string, errors: string[] }}
 */
export function validatePullRequestBody({ body = '', author = '', changedFiles = [] }) {
  if (EXEMPT_BOTS.has(author)) {
    return { ok: true, skipped: `Exempt bot author: ${author}`, errors: [] };
  }

  const normalizedFiles = changedFiles.map((f) => f.trim()).filter(Boolean);
  const docsOnly =
    normalizedFiles.length > 0 && normalizedFiles.every((file) => isDocsOrLocaleFile(file));

  const errors = [];
  const normalizedBody = body.replace(/\r\n/g, '\n');

  // 1. What changed
  const whatChanged = extractSection(normalizedBody, 'What changed');
  if (whatChanged === null) {
    errors.push('Missing `## What changed` section.');
  } else {
    const cleaned = stripHtmlComments(whatChanged)
      .replace(/^\s*[-*]\s+\*\*(Before|After)[^*]*?\*\*:?\s*$/gim, '')
      .trim();
    if (cleaned.length < 15) {
      errors.push(
        '`## What changed` needs a brief plain-English summary (and Before/After behavior) for reviewers.',
      );
    }
  }

  // 2. AI usage (Crest-style two-box rule, enforced for all PRs including docs-only)
  const aiUsage = extractSection(normalizedBody, 'AI usage');
  if (aiUsage === null) {
    if (!docsOnly) {
      errors.push('Missing `## AI usage` section.');
    }
  } else {
    const boxes = parseCheckboxes(aiUsage);
    const aiHelped = boxes.find((box) => /AI tools helped/i.test(box.label));
    const skillRan = boxes.find((box) => /asyar-contribution/i.test(box.label));
    if (!aiHelped || !skillRan) {
      errors.push('Keep both checkboxes in `## AI usage` intact.');
    } else if (aiHelped.checked && !skillRan.checked) {
      errors.push(
        'If AI tools helped produce this change, also run `.agents/skills/asyar-contribution/SKILL.md`, review every generated line, and check the second `## AI usage` box.',
      );
    } else if (!aiHelped.checked && skillRan.checked) {
      errors.push(
        'Check `AI tools helped produce this change.` if you ran the `asyar-contribution` skill.',
      );
    }
  }

  if (docsOnly) {
    return {
      ok: errors.length === 0,
      skipped:
        errors.length === 0 ? 'Docs/locale-only PR (smoke test & boundaries exempt)' : undefined,
      errors,
    };
  }

  // 3. Affected areas
  const affectedAreas = extractSection(normalizedBody, 'Affected areas');
  if (affectedAreas === null) {
    errors.push('Missing `## Affected areas` section.');
  } else {
    const boxes = parseCheckboxes(affectedAreas);
    if (!boxes.some((box) => box.checked)) {
      errors.push('Check at least one box under `## Affected areas`.');
    }
  }

  // 4. Manual smoke test & Validation
  const smokeTest = extractSection(normalizedBody, 'Manual smoke test & Validation');
  if (smokeTest === null) {
    errors.push('Missing `## Manual smoke test & Validation` section.');
  } else {
    const boxes = parseCheckboxes(smokeTest);
    const smokeBox = boxes.find((box) => /manually smoke-tested/i.test(box.label));
    if (!smokeBox || !smokeBox.checked) {
      errors.push(
        'Confirm you manually smoke-tested the running app by checking the box under `## Manual smoke test & Validation`.',
      );
    }

    const descriptionOnly = stripHtmlComments(smokeTest)
      .replace(/^\s*[-*]\s+\[[ xX]\]\s+.+$/gm, '')
      .trim();
    if (descriptionOnly.length < 10) {
      errors.push(
        'Briefly describe what you tested in the running app and which automated checks ran under `## Manual smoke test & Validation`.',
      );
    }
  }

  // 5. Boundaries
  const requiredBoundaries = [
    { name: 'Zero-hardcoded-strings i18n', pattern: /Zero-hardcoded-strings i18n/i },
    {
      name: 'Third-party extension compatibility',
      pattern: /Third-party extension compatibility/i,
    },
    { name: 'Hot paths remain fast', pattern: /Hot paths remain fast/i },
    { name: 'pnpm check:ci', pattern: /pnpm check:ci/i },
  ];
  const boundaries = extractSection(normalizedBody, 'Boundaries');
  if (boundaries === null) {
    errors.push('Missing `## Boundaries` section.');
  } else {
    const boxes = parseCheckboxes(boundaries);
    for (const required of requiredBoundaries) {
      const match = boxes.find((box) => required.pattern.test(box.label));
      if (!match || !match.checked) {
        errors.push(`Confirm \`${required.name}\` under \`## Boundaries\`.`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function parseArgs(argv) {
  const args = { eventPath: null, bodyFile: null, filesPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--event' && argv[i + 1]) {
      args.eventPath = argv[++i];
    } else if (arg === '--body-file' && argv[i + 1]) {
      args.bodyFile = argv[++i];
    } else if (arg === '--files' && argv[i + 1]) {
      args.filesPath = argv[++i];
    }
  }
  return args;
}

function main() {
  const { eventPath, bodyFile, filesPath } = parseArgs(process.argv.slice(2));
  let body = '';
  let author = '';
  let changedFiles = [];

  if (eventPath) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    body = event.pull_request?.body ?? '';
    author = event.pull_request?.user?.login ?? '';
  } else if (bodyFile) {
    body = readFileSync(bodyFile, 'utf8');
  } else {
    console.error(
      'Usage: node scripts/check-pr.mjs [--event <path> | --body-file <path>] [--files <path>]',
    );
    process.exit(2);
  }

  if (filesPath) {
    changedFiles = readFileSync(filesPath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const result = validatePullRequestBody({ body, author, changedFiles });
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
