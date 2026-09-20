import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getActiveContext, setRaycastContext } from './context';
import type { ExtensionContextCore } from 'asyar-sdk/contracts';

describe('context resolver', () => {
  beforeEach(() => {
    setRaycastContext(undefined);
    delete (globalThis as any).__ASYAR_EXTENSION_CONTEXT__;
  });

  it('allows injecting a context via setRaycastContext', () => {
    const mockContext = {
      getService: vi.fn(),
      preferences: { values: { theme: 'dark' } },
    } as unknown as ExtensionContextCore;

    setRaycastContext(mockContext);
    expect(getActiveContext()).toBe(mockContext);
  });

  it('reads globalThis.__ASYAR_EXTENSION_CONTEXT__ if available', () => {
    const mockContext = {
      getService: vi.fn(),
      preferences: { values: { key: 'val' } },
    } as unknown as ExtensionContextCore;

    (globalThis as any).__ASYAR_EXTENSION_CONTEXT__ = mockContext;
    expect(getActiveContext()).toBe(mockContext);
  });

  it('falls back to lazily creating a context if none set', () => {
    const ctx = getActiveContext();
    expect(ctx).toBeDefined();
    expect(typeof ctx.getService).toBe('function');
  });
});
