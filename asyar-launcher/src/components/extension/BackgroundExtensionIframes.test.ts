/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { computeBackgroundIframeSet, type ExtensionLite } from './backgroundIframeSet';

const ext = (id: string, enabled = true, builtIn = false): ExtensionLite => ({
  manifest: { id },
  enabled,
  isBuiltIn: builtIn,
});

describe('computeBackgroundIframeSet', () => {
  it('keeps enabled non-builtin entries whose extension is enabled', () => {
    const entries = [{ extensionId: 'ext.a', mountToken: 7 }];
    const extensions = [ext('ext.a')];
    const result = computeBackgroundIframeSet(entries, extensions, null);
    expect(result).toEqual(entries);
  });

  it('drops entries whose extension is disabled', () => {
    const entries = [{ extensionId: 'ext.a', mountToken: 7 }];
    const extensions = [ext('ext.a', false)];
    expect(computeBackgroundIframeSet(entries, extensions, null)).toEqual([]);
  });

  it('drops entries whose extension is built-in', () => {
    const entries = [{ extensionId: 'ext.a', mountToken: 7 }];
    const extensions = [ext('ext.a', true, true)];
    expect(computeBackgroundIframeSet(entries, extensions, null)).toEqual([]);
  });

  it('drops the active-view extension', () => {
    const entries = [{ extensionId: 'ext.a', mountToken: 7 }];
    const extensions = [ext('ext.a')];
    expect(computeBackgroundIframeSet(entries, extensions, 'ext.a/DefaultView'))
      .toEqual([]);
  });

  it('drops registry entries without a matching enabled extension', () => {
    const entries = [
      { extensionId: 'ext.a', mountToken: 7 },
      { extensionId: 'ext.unknown', mountToken: 8 },
    ];
    const extensions = [ext('ext.a')];
    expect(computeBackgroundIframeSet(entries, extensions, null)).toEqual([
      { extensionId: 'ext.a', mountToken: 7 },
    ]);
  });
});
