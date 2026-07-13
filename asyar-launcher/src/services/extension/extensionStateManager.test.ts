/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { extensionStateManager } from './extensionStateManager.svelte';

describe('extensionStateManager — needsRuntime', () => {
  beforeEach(() => {
    extensionStateManager.needsRuntime = [];
  });

  it('markNeedsRuntime adds the extension id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('markNeedsRuntime dedupes repeated calls for the same id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });

  it('markNeedsRuntime tracks multiple distinct extensions', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.b');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a', 'ext.b']);
  });

  it('clearNeedsRuntime removes the extension id', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.markNeedsRuntime('ext.b');
    extensionStateManager.clearNeedsRuntime('ext.a');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.b']);
  });

  it('clearNeedsRuntime on an id that was never marked is a no-op', () => {
    extensionStateManager.markNeedsRuntime('ext.a');
    extensionStateManager.clearNeedsRuntime('ext.never-marked');
    expect(extensionStateManager.needsRuntime).toEqual(['ext.a']);
  });
});
