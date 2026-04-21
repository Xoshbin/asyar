/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../extension/extensionDispatcher.svelte', () => ({ dispatch: vi.fn() }));

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
});
