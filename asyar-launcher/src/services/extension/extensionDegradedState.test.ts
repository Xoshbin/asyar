/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn().mockResolvedValue(undefined) },
}));

import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';
import { extensionDegradedState } from './extensionDegradedState.svelte';

describe('extensionDegradedState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionDegradedState.reset();
  });

  it('first user-facing notice reports an error diagnostic', () => {
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    expect(diagnosticsService.report).toHaveBeenCalledTimes(1);
    expect(diagnosticsService.report).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'manual',
      severity: 'error',
      context: expect.objectContaining({ message: expect.stringContaining("Ext A") }),
    }));
  });

  it('subsequent notices within a session are deduped', () => {
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    expect(diagnosticsService.report).toHaveBeenCalledTimes(1);
  });

  it('recovery resets dedupe for future Degraded', () => {
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    extensionDegradedState.recovered('ext.a');
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    expect(diagnosticsService.report).toHaveBeenCalledTimes(2);
  });
});
