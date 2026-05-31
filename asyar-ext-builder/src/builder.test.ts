import { describe, it, expect } from 'bun:test';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureBaseDir, isSafeExtensionId, resolveExtensionId, buildInstructions } from './builder';
import { knowledgePromptSection } from './knowledge';

describe('isSafeExtensionId', () => {
  it('allows valid dot/dash/alnum slugs', () => {
    expect(isSafeExtensionId('com.user.notion')).toBe(true);
    expect(isSafeExtensionId('unit-converter')).toBe(true);
    expect(isSafeExtensionId('a.b.c')).toBe(true);
  });

  it('denies traversal, empty segments, separators, and edge cases', () => {
    expect(isSafeExtensionId('..')).toBe(false);
    expect(isSafeExtensionId('../etc')).toBe(false);
    expect(isSafeExtensionId('a/../b')).toBe(false);
    expect(isSafeExtensionId('.')).toBe(false);
    expect(isSafeExtensionId('a..b')).toBe(false);
    expect(isSafeExtensionId('/abs')).toBe(false);
    expect(isSafeExtensionId('a/b')).toBe(false);
    expect(isSafeExtensionId('')).toBe(false);
    expect(isSafeExtensionId('a.')).toBe(false);
    expect(isSafeExtensionId('.a')).toBe(false);
  });
});

describe('resolveExtensionId (path-traversal guard)', () => {
  it('throws on a malicious EXTENSION_ID marker', () => {
    expect(() =>
      resolveExtensionId('EXTENSION_ID=../../evil', '/tmp/base', new Set()),
    ).toThrow();
  });

  it('returns a good id from a clean marker', () => {
    expect(resolveExtensionId('EXTENSION_ID=com.user.tool blah', '/tmp/base', new Set())).toBe(
      'com.user.tool',
    );
  });
});

describe('ensureBaseDir', () => {
  it('creates a nested non-existent directory', () => {
    const base = mkdtempSync(join(tmpdir(), 'asyar-eb-'));
    const target = join(base, 'AsyarExtensions', 'deep');
    expect(existsSync(target)).toBe(false);
    ensureBaseDir(target);
    expect(existsSync(target)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });
  it('is idempotent when the directory already exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'asyar-eb-'));
    expect(() => ensureBaseDir(base)).not.toThrow();
    rmSync(base, { recursive: true, force: true });
  });
});

describe('buildInstructions includes live knowledge URLs', () => {
  it('injects the knowledgePromptSection (example/doc URLs + guidance)', () => {
    const input = {
      prompt: 'make a unit converter',
      baseDir: '/tmp/x',
      capabilitySpecDir: '/spec',
      authoringGuide: 'rules',
      askUser: async () => '',
    } as any;
    const text = buildInstructions(input);
    const section = knowledgePromptSection();
    for (const line of section.split('\n')) {
      expect(text).toContain(line);
    }
    expect(text).toContain('WebFetch');
  });
});
