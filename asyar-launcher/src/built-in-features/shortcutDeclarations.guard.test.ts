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

/** `shortcut: '…'` literals (and platform ternaries) declared on actions in a feature's source. */
function sourceDeclarations(feature: string): {
  file: string;
  scope: string;
  shortcut: string;
  ternaryGroup?: number;
}[] {
  const out: { file: string; scope: string; shortcut: string; ternaryGroup?: number }[] = [];
  let nextGroup = 1;
  for (const file of sourceFiles(join(ROOT, feature))) {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(ROOT.length + 1);
    const lines = text.split('\n');
    let currentMethod = '';

    const scopeAtOffset = (offset: number): string => {
      const upTo = text.slice(0, offset);
      const lineIdx = upTo.split('\n').length - 1;
      for (let i = lineIdx; i >= 0; i--) {
        const m = lines[i].match(/\b(register\w*Actions)\s*\(/);
        if (m) return `${rel}#${m[1]}`;
      }
      return rel;
    };

    const ternaryMatches: Array<{ start: number; end: number }> = [];
    for (const m of text.matchAll(
      /\bshortcut:\s*[^,\n;]*?\?\s*(['"`])([^'"`]+)\1\s*:\s*(['"`])([^'"`]+)\3/g,
    )) {
      const idx = m.index ?? 0;
      const scope = scopeAtOffset(idx);
      const group = nextGroup++;
      ternaryMatches.push({ start: idx, end: idx + m[0].length });
      out.push({ file: rel, scope, shortcut: m[2], ternaryGroup: group });
      out.push({ file: rel, scope, shortcut: m[4], ternaryGroup: group });
    }

    for (const m of text.matchAll(/\bshortcut:\s*(['"`])([^'"`]*)\1/g)) {
      const idx = m.index ?? 0;
      if (ternaryMatches.some((r) => idx >= r.start && idx < r.end)) continue;
      out.push({ file: rel, scope: scopeAtOffset(idx), shortcut: m[2] });
    }
    void currentMethod;
  }
  return out;
}

describe('built-in action shortcut declarations', () => {
  it('no built-in manifest declares root-search actions (they live in views)', () => {
    for (const feature of features) {
      const manifest = manifestOf(feature) as {
        actions?: unknown;
        commands?: { actions?: unknown }[];
      } | null;
      expect(manifest?.actions, `${feature} manifest`).toBeUndefined();
      for (const cmd of manifest?.commands ?? []) {
        expect(cmd.actions, `${feature} command`).toBeUndefined();
      }
    }
  });

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
      // In-view: source-declared shortcuts within the same view scope must all
      // be distinct, with exceptions only for mutually-exclusive visibility gates:
      //  - complementary pin/unpin actions sharing `Mod+.`
      //  - scripts:run and scripts:make-executable sharing `Enter`
      const declarations = sourceDeclarations(feature);
      const byScope = new Map<string, typeof declarations>();
      for (const d of declarations) {
        const list = byScope.get(d.scope) ?? [];
        list.push(d);
        byScope.set(d.scope, list);
      }
      for (const [scope, scopeDecls] of byScope) {
        // Count each platform ternary once per action declaration.
        const seenGroups = new Set<number>();
        const chordCounts = new Map<string, number>();
        for (const d of scopeDecls) {
          if (d.ternaryGroup !== undefined) {
            if (seenGroups.has(d.ternaryGroup)) continue;
            seenGroups.add(d.ternaryGroup);
          }
          chordCounts.set(d.shortcut, (chordCounts.get(d.shortcut) ?? 0) + 1);
        }
        for (const [chord, count] of chordCounts) {
          if (count > 1) {
            if (chord === 'Mod+.' && count === 2) continue;
            if (feature === 'scripts' && chord === 'Enter' && count === 2) continue;
            expect(count, `${feature} (${scope}) in-view actions sharing chord ${chord}`).toBe(1);
          }
        }
      }
    });

    it('has no hand-written keydown check for a chord it declares as an action', () => {
      const keys = new Set(
        declared
          .map((d) => d.shortcut.split('+').pop()!)
          .filter((k) => /^[A-Z0-9]$/.test(k))
          .map((k) => k.toLowerCase()),
      );
      const declaresEnter = declared.some((d) => d.shortcut === 'Enter');
      if (keys.size === 0 && !declaresEnter) return;
      for (const file of sourceFiles(join(ROOT, feature))) {
        const rel = file.slice(ROOT.length + 1);
        const text = readFileSync(file, 'utf8');
        const fileDeclaresEnter = declared.some((d) => d.where === rel && d.shortcut === 'Enter');
        if (fileDeclaresEnter && /keydown/i.test(text)) {
          const enterCheck = /(?:\.key\s*===?\s*['"]Enter['"]|case\s+['"]Enter['"])/;
          expect(
            enterCheck.test(text),
            `${rel} hand-handles Enter, which it also declares as an action shortcut; delete the handler`,
          ).toBe(false);
        }
        if (keys.size === 0 || !/keydown/i.test(text) || !/\.(metaKey|ctrlKey)/.test(text))
          continue;
        for (const m of text.matchAll(/\.key(?:\.toLowerCase\(\))?\s*===?\s*(['"])(.)\1/g)) {
          const letter = m[2].toLowerCase();
          expect(
            keys.has(letter),
            `${rel} hand-handles ⌘/Ctrl+${letter.toUpperCase()}, which ${feature} also declares as an action shortcut; delete the handler`,
          ).toBe(false);
        }
      }
    });
  });

  it('migrated the known duplicated and standardized Raycast chords', () => {
    const clipboard = sourceDeclarations('clipboard-history').map((d) => d.shortcut);
    const notes = sourceDeclarations('notes').map((d) => d.shortcut);
    const snippets = sourceDeclarations('snippets').map((d) => d.shortcut);
    const portals = sourceDeclarations('portals').map((d) => d.shortcut);
    const fileSearch = sourceDeclarations('file-search').map((d) => d.shortcut);
    const agents = sourceDeclarations('agents').map((d) => d.shortcut);

    expect(clipboard).toContain('Mod+.');
    expect(clipboard).toContain('Control+X');
    expect(clipboard).toContain('Control+Shift+X');
    expect(notes).toContain('Mod+N');
    expect(notes).toContain('Mod+.');
    expect(notes).toContain('Control+X');
    expect(snippets).toContain('Mod+N');
    expect(snippets).toContain('Mod+.');
    expect(snippets).toContain('Control+X');
    expect(snippets).toContain('Control+Shift+X');
    expect(portals).toContain('Mod+N');
    expect(portals).toContain('Control+X');
    expect(fileSearch).toContain('Mod+.');
    expect(fileSearch).toContain('Control+X');
    expect(fileSearch).toContain('Control+Shift+X');
    expect(agents).toContain('Mod+N');
    expect(agents).toContain('Mod+.');
    expect(agents).toContain('Control+X');
  });
});
