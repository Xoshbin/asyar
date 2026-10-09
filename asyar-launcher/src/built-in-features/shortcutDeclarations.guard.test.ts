/**
 * Guard (rule 05 §7): an action's `shortcut` is a single declaration that both
 * shows the hint and binds the key through the action shortcut dispatcher.
 * This asserts against what ships — the loaded built-in manifests and the
 * `shortcut` declarations in each feature's source — that:
 *  1. every declared shortcut is canonical (`Mod+…`, valid key, not reserved);
 *  2. no two actions that can be visible together share a chord;
 *  3. no feature keeps a hand-written `keydown` check for a chord it also
 *     declares as an action shortcut (the old duplicated-handler pattern).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateActionShortcut } from '../lib/keyboard/actionShortcut';

const ROOT = __dirname;

interface ManifestAction {
  id: string;
  shortcut?: string;
}
interface Manifest {
  id: string;
  actions?: ManifestAction[];
  commands?: { id: string; actions?: ManifestAction[] }[];
}

const features = readdirSync(ROOT).filter((d) => statSync(join(ROOT, d)).isDirectory());

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

function manifestOf(feature: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(ROOT, feature, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

/** `shortcut: '…'` literals declared on actions in a feature's source. */
function sourceDeclarations(feature: string): { file: string; shortcut: string }[] {
  const out: { file: string; shortcut: string }[] = [];
  for (const file of sourceFiles(join(ROOT, feature))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bshortcut:\s*(['"`])([^'"`]*)\1/g)) {
      out.push({ file: file.slice(ROOT.length + 1), shortcut: m[2] });
    }
  }
  return out;
}

describe('built-in action shortcut declarations', () => {
  it('scans the shipped features', () => {
    expect(features.length).toBeGreaterThan(10);
  });

  describe.each(features)('%s', (feature) => {
    const manifest = manifestOf(feature);
    const declared: { where: string; shortcut: string }[] = [
      ...(manifest?.actions ?? [])
        .filter((a) => a.shortcut)
        .map((a) => ({ where: `manifest action ${a.id}`, shortcut: a.shortcut! })),
      ...(manifest?.commands ?? []).flatMap((c) =>
        (c.actions ?? [])
          .filter((a) => a.shortcut)
          .map((a) => ({ where: `manifest ${c.id}/${a.id}`, shortcut: a.shortcut! })),
      ),
      ...sourceDeclarations(feature).map((d) => ({
        where: d.file,
        shortcut: d.shortcut,
      })),
    ];

    it('declares only canonical shortcuts', () => {
      for (const d of declared) {
        expect(
          validateActionShortcut(d.shortcut),
          `${feature}: ${d.where} '${d.shortcut}'`,
        ).toBeNull();
      }
    });

    it('never lets two actions visible together share a chord', () => {
      // Root search: extension-level actions show for every command of the
      // extension, command-level ones only for their own command.
      const extLevel = (manifest?.actions ?? []).filter((a) => a.shortcut);
      for (const cmd of manifest?.commands ?? []) {
        const visible = [...extLevel, ...(cmd.actions ?? []).filter((a) => a.shortcut)];
        const chords = visible.map((a) => a.shortcut);
        expect(new Set(chords).size, `${feature}/${cmd.id} root actions`).toBe(chords.length);
      }
      // In-view: every source-declared shortcut in one feature is live in the
      // same view context, so they must all be distinct.
      const inView = sourceDeclarations(feature).map((d) => d.shortcut);
      expect(new Set(inView).size, `${feature} in-view actions`).toBe(inView.length);
    });

    it('has no hand-written keydown check for a chord it declares as an action', () => {
      const keys = new Set(
        declared
          .map((d) => d.shortcut.split('+').pop()!)
          .filter((k) => /^[A-Z0-9]$/.test(k))
          .map((k) => k.toLowerCase()),
      );
      if (keys.size === 0) return;
      for (const file of sourceFiles(join(ROOT, feature))) {
        const text = readFileSync(file, 'utf8');
        if (!/keydown/i.test(text) || !/\.(metaKey|ctrlKey)/.test(text)) continue;
        for (const m of text.matchAll(/\.key(?:\.toLowerCase\(\))?\s*===?\s*(['"])(.)\1/g)) {
          const letter = m[2].toLowerCase();
          expect(
            keys.has(letter),
            `${file.slice(ROOT.length + 1)} hand-handles ⌘/Ctrl+${letter.toUpperCase()}, which ${feature} also declares as an action shortcut; delete the handler`,
          ).toBe(false);
        }
      }
    });
  });

  it('migrated the known duplicated chords to a single declaration', () => {
    const notes = sourceDeclarations('notes').map((d) => d.shortcut);
    const snippets = sourceDeclarations('snippets').map((d) => d.shortcut);
    const portals = sourceDeclarations('portals').map((d) => d.shortcut);
    const agents = sourceDeclarations('agents').map((d) => d.shortcut);
    expect(notes).toContain('Mod+N');
    expect(snippets).toContain('Mod+N');
    expect(portals).toContain('Mod+N');
    expect(agents).toContain('Mod+N');
  });
});
