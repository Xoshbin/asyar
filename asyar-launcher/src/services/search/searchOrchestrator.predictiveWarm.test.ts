/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../extension/extensionDispatcher.svelte', () => ({ dispatch: vi.fn() }));
vi.mock('../run/runService.svelte', () => ({ runService: {} }));
vi.mock('../extension/extensionDiscovery', () => ({
  isBuiltInFeature: (id: string) => id === 'walkthrough' || id === 'notes',
  extensionContext: {},
  builtInFeatureContext: {},
}));

import { dispatch } from '../extension/extensionDispatcher.svelte';
import { warmIfTier2 } from './searchOrchestrator.svelte';

describe('warmIfTier2', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dispatches a predictiveWarm for a Tier 2 command item', () => {
    warmIfTier2({
      type: 'command',
      extensionId: 'ext.a',
      objectId: 'cmd_ext.a_run',
    } as any);
    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'ext.a',
      kind: 'predictiveWarm',
      payload: {},
      source: 'userHighlight',
      commandMode: 'view',
    });
  });

  it('does not dispatch for items without extensionId', () => {
    warmIfTier2({ type: 'command' } as any);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch for non-command items', () => {
    warmIfTier2({ type: 'application', extensionId: 'x' } as any);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch for undefined item', () => {
    warmIfTier2(undefined);
    expect(dispatch).not.toHaveBeenCalled();
  });

  // Search results come from Rust, whose SearchResult has no `isBuiltIn`
  // field — so a guard reading `item.isBuiltIn` never fires and every Tier 1
  // row warms an iframe that will never exist, then times out.
  it('does not dispatch for a Tier 1 built-in row', () => {
    warmIfTier2({
      type: 'command',
      extensionId: 'walkthrough',
      objectId: 'cmd_walkthrough_show-walkthrough',
    } as any);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch for a built-in row even when isBuiltIn is absent', () => {
    warmIfTier2({ type: 'command', extensionId: 'notes', objectId: 'cmd_notes_open-notes' } as any);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
