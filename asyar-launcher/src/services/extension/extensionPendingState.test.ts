/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extensionPendingState } from './extensionPendingState.svelte';

describe('extensionPendingState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    extensionPendingState.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show pending before 200 ms', () => {
    extensionPendingState.markPending('ext.a');
    expect(extensionPendingState.isPending('ext.a')).toBe(false);
    vi.advanceTimersByTime(199);
    expect(extensionPendingState.isPending('ext.a')).toBe(false);
  });

  it('shows pending at 200 ms', () => {
    extensionPendingState.markPending('ext.a');
    vi.advanceTimersByTime(200);
    expect(extensionPendingState.isPending('ext.a')).toBe(true);
  });

  it('clears pending on markReady', () => {
    extensionPendingState.markPending('ext.a');
    vi.advanceTimersByTime(200);
    extensionPendingState.markReady('ext.a');
    expect(extensionPendingState.isPending('ext.a')).toBe(false);
  });

  it('markPending while already pending is idempotent', () => {
    extensionPendingState.markPending('ext.a');
    vi.advanceTimersByTime(100);
    extensionPendingState.markPending('ext.a');
    vi.advanceTimersByTime(100);
    expect(extensionPendingState.isPending('ext.a')).toBe(true);
  });

  it('markReady before timer fires cancels the pending transition', () => {
    extensionPendingState.markPending('ext.a');
    vi.advanceTimersByTime(100);
    extensionPendingState.markReady('ext.a');
    vi.advanceTimersByTime(500);
    expect(extensionPendingState.isPending('ext.a')).toBe(false);
  });
});
