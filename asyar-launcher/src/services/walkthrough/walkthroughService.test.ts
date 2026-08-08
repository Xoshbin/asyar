import { describe, it, expect } from 'vitest';
import type { ExtensionManifest } from 'asyar-sdk/contracts';
import { collectContributions, collectProbes } from './walkthroughService.svelte';

function manifest(partial: Partial<ExtensionManifest> & { id: string }): ExtensionManifest {
  return {
    name: partial.id,
    version: '1.0.0',
    description: '',
    commands: [],
    ...partial,
  } as ExtensionManifest;
}

describe('collectContributions', () => {
  it('returns nothing when no manifest declares tasks', () => {
    expect(collectContributions([manifest({ id: 'a' }), manifest({ id: 'b' })])).toEqual([]);
  });

  it('collects declared tasks keyed by extension id', () => {
    const result = collectContributions([
      manifest({
        id: 'org.asyar.calculator',
        walkthrough: [{ id: 'use-it', title: 'Use it', completion: { type: 'manual' } }],
      }),
    ]);

    expect(result).toEqual([
      {
        extensionId: 'org.asyar.calculator',
        tasks: [{ id: 'use-it', title: 'Use it', completion: { type: 'manual' } }],
      },
    ]);
  });

  it('skips manifests with an empty walkthrough array', () => {
    expect(collectContributions([manifest({ id: 'a', walkthrough: [] })])).toEqual([]);
  });

  it('treats a third-party extension exactly like a built-in', () => {
    const result = collectContributions([
      manifest({
        id: 'org.asyar.builtin',
        walkthrough: [{ id: 't', title: 'T', completion: { type: 'manual' } }],
      }),
      manifest({
        id: 'com.someone.thirdparty',
        walkthrough: [{ id: 't', title: 'T', completion: { type: 'manual' } }],
      }),
    ]);

    expect(result.map((c) => c.extensionId)).toEqual([
      'org.asyar.builtin',
      'com.someone.thirdparty',
    ]);
  });

  it('ignores a malformed walkthrough field instead of throwing', () => {
    const bad = manifest({ id: 'a' });
    (bad as unknown as { walkthrough: unknown }).walkthrough = 'not an array';
    expect(collectContributions([bad])).toEqual([]);
  });
});

describe('collectProbes', () => {
  const sources = {
    snippetCount: () => 3,
    aliasCount: () => 1,
    shortcutCount: () => 2,
    portalCount: () => 0,
    noteCount: () => 5,
    installedExtensionCount: () => 4,
  };

  it('reports every probe the built-in task set uses', () => {
    expect(collectProbes(sources)).toEqual({
      'snippets.count': 3,
      'aliases.count': 1,
      'shortcuts.count': 2,
      'portals.count': 0,
      'notes.count': 5,
      'extensions.installedCount': 4,
    });
  });

  it('reports zero for a source that throws rather than failing the sync', () => {
    const probes = collectProbes({
      ...sources,
      snippetCount: () => {
        throw new Error('store not ready');
      },
    });
    expect(probes['snippets.count']).toBe(0);
    expect(probes['notes.count']).toBe(5);
  });

  it('coerces a nullish count to zero', () => {
    const probes = collectProbes({
      ...sources,
      aliasCount: () => undefined as unknown as number,
    });
    expect(probes['aliases.count']).toBe(0);
  });
});
