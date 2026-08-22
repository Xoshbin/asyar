import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import enCatalog from '../../locales/en.json';

function getAllKeys(obj: Record<string, any>, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      for (const subKey of getAllKeys(value, fullKey)) {
        keys.add(subKey);
      }
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

function findSvelteFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__tests__' && entry.name !== 'dist') {
        results.push(...findSvelteFiles(fullPath));
      }
    } else if (entry.isFile() && (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts'))) {
      if (!entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe('i18n Static Analysis & Hardcoded String Prevention', () => {
  const catalogKeys = getAllKeys(enCatalog);
  const srcDir = path.resolve(__dirname, '../../');
  const svelteFiles = findSvelteFiles(srcDir);

  it('every t("key") call references a valid key in en.json', () => {
    const tCallRegex = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
    const missingKeys: { file: string; key: string }[] = [];

    for (const file of svelteFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = tCallRegex.exec(content)) !== null) {
        const key = match[1];
        if (!catalogKeys.has(key)) {
          missingKeys.push({ file: path.relative(srcDir, file), key });
        }
      }
    }

    expect(
      missingKeys,
      `Found calls to t() with undefined keys in en.json:\n${missingKeys.map((m) => `  ${m.file}: t('${m.key}')`).join('\n')}`,
    ).toEqual([]);
  });

  it('prevents hardcoded EmptyState messages and descriptions across the entire launcher', () => {
    const emptyStateMsgRegex = /<EmptyState[^>]*\bmessage="([^"]+)"/g;
    const emptyStateDescRegex = /<EmptyState[^>]*\bdescription="([^"]+)"/g;
    const violations: { file: string; prop: string; text: string }[] = [];

    for (const file of svelteFiles) {
      if (!file.endsWith('.svelte')) continue;
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = emptyStateMsgRegex.exec(content)) !== null) {
        violations.push({
          file: path.relative(srcDir, file),
          prop: 'message',
          text: match[1],
        });
      }
      while ((match = emptyStateDescRegex.exec(content)) !== null) {
        violations.push({
          file: path.relative(srcDir, file),
          prop: 'description',
          text: match[1],
        });
      }
    }

    expect(
      violations,
      `EmptyState components must use message={t('...')} and description={t('...')} instead of hardcoded strings:\n${violations.map((h) => `  ${h.file}: ${h.prop}="${h.text}"`).join('\n')}`,
    ).toEqual([]);
  });

  it('prevents known hardcoded common phrases in core launcher views', () => {
    const forbiddenPhrases = [
      'No results found',
      'No matching actions',
      'Select an item to view details',
      'Select an extension to view details',
      'No custom layouts yet',
      'No scripts found',
      'Streaming… ⌘K to cancel',
      'Set up your AI',
      'Start chatting',
    ];

    const coreDirs = [
      path.join(srcDir, 'components/layout'),
      path.join(srcDir, 'components/feedback'),
      path.join(srcDir, 'built-in-features/clipboard-history'),
      path.join(srcDir, 'built-in-features/window-management'),
      path.join(srcDir, 'built-in-features/store'),
      path.join(srcDir, 'built-in-features/scripts'),
      path.join(srcDir, 'built-in-features/agents'),
    ];

    const violations: { file: string; phrase: string }[] = [];

    for (const dir of coreDirs) {
      for (const file of findSvelteFiles(dir)) {
        if (!file.endsWith('.svelte')) continue;
        const content = fs.readFileSync(file, 'utf-8');
        // Strip <script> and <style> sections to inspect template only
        const templateOnly = content
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '');

        for (const phrase of forbiddenPhrases) {
          if (templateOnly.includes(`"${phrase}"`) || templateOnly.includes(`'${phrase}'`)) {
            violations.push({ file: path.relative(srcDir, file), phrase });
          }
        }
      }
    }

    expect(
      violations,
      `Found hardcoded UI strings in templates that should use t():\n${violations.map((v) => `  ${v.file}: "${v.phrase}"`).join('\n')}`,
    ).toEqual([]);
  });
});
