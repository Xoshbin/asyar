import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'svelte/compiler';
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

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== 'node_modules' &&
        entry.name !== '__tests__' &&
        entry.name !== 'dist' &&
        entry.name !== '.svelte-kit'
      ) {
        results.push(...findFiles(fullPath, extensions));
      }
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      if (!entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// Brand names, technologies, keyboard key names, and technical identifiers allowed in templates
const ALLOWED_LITERALS = new Set([
  'asyar',
  'github',
  'google',
  'openai',
  'ollama',
  'macos',
  'windows',
  'linux',
  'chrome',
  'firefox',
  'safari',
  'edge',
  'brave',
  'arc',
  'vivaldi',
  'discord',
  'json',
  'url',
  'http',
  'https',
  'id',
  'ipc',
  'rpc',
  'sdk',
  'cli',
  'mcp',
  'ai',
  'api',
  'zsh',
  'bash',
  'sh',
  'utf-8',
  'tauri',
  'rust',
  'svelte',
  'typescript',
  'khoshbin ali',
  'tab',
  'enter',
  'esc',
  'ctrl',
  'cmd',
  'alt',
  'shift',
]);

const SENSITIVE_PROPS = new Set([
  'label',
  'description',
  'placeholder',
  'message',
  'emptyMessage',
  'kicker',
  'hint',
  'subtitle',
  'error',
]);

function isIgnoredTag(name: string): boolean {
  return ['script', 'style', 'pre', 'code', 'svg', 'textarea'].includes(name.toLowerCase());
}

function isTechnicalOrSymbol(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Pure punctuation, symbols, mathematical operators, or emojis (e.g. ⌘K, +, ×, —, •, ✓, ★, ☆, ✕, ⚠️)
  if (/^[\p{P}\p{S}\p{N}\s]+$/u.test(trimmed)) return true;
  if (ALLOWED_LITERALS.has(trimmed.toLowerCase())) return true;
  // Examples starting with "e.g." or "i.e."
  if (/^(?:e\.g\.|i\.e\.)/i.test(trimmed)) return true;
  // Dot-notation identifiers (e.g. com.example.vault, my-server) or namespaced IDs (shell:spawn)
  if (/^[a-z0-9_.-]+:[a-z0-9_.-]+$/i.test(trimmed)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(trimmed)) return true;
  if (/^[a-z0-9]+-[a-z0-9-]+$/i.test(trimmed)) return true;
  // URLs or file paths
  if (/^(?:https?:\/\/|\/|\.\/|\~\/)/.test(trimmed)) return true;
  // Formats like "0.70", "2048", "12px", "100%", "500ms"
  if (/^[0-9]+(?:\.[0-9]+)?\s*(?:px|rem|em|vh|vw|ms|s|%|deg|bytes|kb|mb|gb)?$/i.test(trimmed)) {
    return true;
  }
  return false;
}

describe('i18n AST Static Analysis & Translation Enforcement', () => {
  const catalogKeys = getAllKeys(enCatalog);
  const srcDir = path.resolve(__dirname, '../../');
  const svelteFiles = findFiles(srcDir, ['.svelte']);
  const allSourceFiles = findFiles(srcDir, ['.svelte', '.ts']);

  it('every t("key") call references an existing key in en.json', () => {
    const tCallRegex = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
    const missingKeys: { file: string; key: string }[] = [];

    for (const file of allSourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(srcDir, file);

      let match;
      while ((match = tCallRegex.exec(content)) !== null) {
        const key = match[1];
        if (!catalogKeys.has(key)) {
          missingKeys.push({ file: rel, key });
        }
      }
    }

    expect(
      missingKeys,
      `Found calls to t() with undefined keys in en.json:\n${missingKeys.map((k) => `  ${k.file}: t('${k.key}')`).join('\n')}`,
    ).toEqual([]);
  });

  it('prevents hardcoded literal strings in user-facing component props', () => {
    const violations: { file: string; prop: string; text: string }[] = [];

    for (const file of svelteFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(srcDir, file);

      let ast;
      try {
        ast = parse(content, { modern: true });
      } catch (err: any) {
        throw new Error(`Failed to parse Svelte AST for ${rel}: ${err.message}`);
      }

      function checkNode(node: any) {
        if (!node) return;

        if (node.type === 'RegularElement' || node.type === 'Component') {
          if (node.attributes) {
            for (const attr of node.attributes) {
              if (attr.type === 'Attribute' && SENSITIVE_PROPS.has(attr.name)) {
                if (Array.isArray(attr.value)) {
                  for (const part of attr.value) {
                    if (part.type === 'Text') {
                      const text = part.data.trim();
                      if (text && !isTechnicalOrSymbol(text) && /[a-zA-Z]{2,}/.test(text)) {
                        violations.push({
                          file: rel,
                          prop: attr.name,
                          text,
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Walk children
        if (node.fragment && node.fragment.nodes) {
          for (const child of node.fragment.nodes) checkNode(child);
        }
        if (node.nodes) {
          for (const child of node.nodes) checkNode(child);
        }
        if (node.body) {
          if (Array.isArray(node.body)) {
            for (const child of node.body) checkNode(child);
          } else {
            checkNode(node.body);
          }
        }
      }

      checkNode(ast.fragment);
    }

    expect(
      violations,
      `Found hardcoded props in Svelte templates. Must use {t('...')} instead of string literals:\n${violations.map((v) => `  ${v.file}: ${v.prop}="${v.text}"`).join('\n')}`,
    ).toEqual([]);
  });

  it('prevents hardcoded button text and action labels across all Svelte templates', () => {
    const violations: { file: string; tag: string; text: string }[] = [];

    for (const file of svelteFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(srcDir, file);

      let ast;
      try {
        ast = parse(content, { modern: true });
      } catch (err: any) {
        throw new Error(`Failed to parse Svelte AST for ${rel}: ${err.message}`);
      }

      function walkElement(node: any, parentTag: string | null = null) {
        if (!node) return;

        if (node.type === 'RegularElement' || node.type === 'Component') {
          const tagName = node.name;
          if (isIgnoredTag(tagName)) return;

          if (node.fragment && node.fragment.nodes) {
            for (const child of node.fragment.nodes) {
              walkElement(child, tagName);
            }
          }
        } else if (node.type === 'Text') {
          if (parentTag && ['button', 'Button', 'option', 'a', 'label'].includes(parentTag)) {
            const text = node.data.trim();
            if (text && !isTechnicalOrSymbol(text) && /[a-zA-Z]{2,}/.test(text)) {
              violations.push({
                file: rel,
                tag: parentTag,
                text,
              });
            }
          }
        } else if (node.fragment && node.fragment.nodes) {
          for (const child of node.fragment.nodes) walkElement(child, parentTag);
        } else if (node.nodes) {
          for (const child of node.nodes) walkElement(child, parentTag);
        } else if (node.body) {
          if (Array.isArray(node.body)) {
            for (const child of node.body) walkElement(child, parentTag);
          } else {
            walkElement(node.body, parentTag);
          }
        }
      }

      walkElement(ast.fragment);
    }

    expect(
      violations,
      `Found hardcoded text in interactive elements (<button>, <Button>, <option>, <label>). Use {t('...')} instead:\n${violations.map((v) => `  ${v.file} (<${v.tag}>): "${v.text}"`).join('\n')}`,
    ).toEqual([]);
  });

  it('prevents hardcoded user-facing strings in <script> blocks', () => {
    const violations: { file: string; prop: string | null; text: string }[] = [];

    for (const file of svelteFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const rel = path.relative(srcDir, file);

      let ast;
      try {
        ast = parse(content, { modern: true });
      } catch (err: any) {
        throw new Error(`Failed to parse Svelte AST for ${rel}: ${err.message}`);
      }

      if (ast.instance?.content) {
        function walkScript(node: any, parentProp: string | null = null) {
          if (!node || typeof node !== 'object') return;

          // Skip imports, typescript declarations, and logger/event calls
          if (
            node.type === 'ImportDeclaration' ||
            node.type === 'TSTypeAliasDeclaration' ||
            node.type === 'TSInterfaceDeclaration' ||
            node.type === 'TSTypeAnnotation'
          ) {
            return;
          }

          if (node.type === 'CallExpression') {
            const calleeName = node.callee?.name || node.callee?.property?.name;
            const objectName = node.callee?.object?.name;
            if (
              calleeName === 't' ||
              objectName === 'logService' ||
              objectName === 'console' ||
              calleeName === 'emit' ||
              calleeName === 'listen' ||
              calleeName === 'postMessage'
            ) {
              return;
            }
          }

          if (node.type === 'Property' && node.key) {
            const propName = node.key.name || node.key.value;
            if (node.value) walkScript(node.value, propName);
            return;
          }

          if (node.type === 'Literal' && typeof node.value === 'string') {
            const text = node.value.trim();
            if (text && !isTechnicalOrSymbol(text) && /[a-zA-Z]{2,}/.test(text)) {
              const isSensitiveProp =
                parentProp &&
                [
                  'label',
                  'description',
                  'title',
                  'message',
                  'placeholder',
                  'hint',
                  'error',
                  'subtitle',
                  'kicker',
                ].includes(parentProp);
              if (isSensitiveProp) {
                violations.push({ file: rel, prop: parentProp, text });
              }
            }
          }

          for (const [key, value] of Object.entries(node)) {
            if (key !== 'key' && typeof value === 'object') {
              if (Array.isArray(value)) {
                for (const item of value) walkScript(item, parentProp);
              } else {
                walkScript(value, parentProp);
              }
            }
          }
        }

        walkScript(ast.instance.content);
      }
    }

    expect(
      violations,
      `Found hardcoded user-facing strings in <script> blocks. Use t('...') instead:\n${violations.map((v) => `  ${v.file} (${v.prop}): "${v.text}"`).join('\n')}`,
    ).toEqual([]);
  });
});
