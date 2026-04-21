/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const WORKER_PROXY_NAMESPACES = [
  'log',
  'notifications',
  'storage',
  'cache',
  'network',
  'shell',
  'ai',
  'oauth',
  'fs',
  'application',
  'power',
  'systemEvents',
  'timers',
  'statusBar',
] as const;

const VIEW_ONLY_NAMESPACES = [
  'feedback',
  'selection',
  'interop',
  'clipboard',
] as const;

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

describe('asyar-sdk/worker — import-time role assertion', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('throws when __ASYAR_ROLE__ is "view"', async () => {
    setRole('view');
    await expect(import('./worker')).rejects.toThrow(/worker/i);
    vi.resetModules();
    setRole('view');
    await expect(import('./worker')).rejects.toThrow(/view/i);
  });

  it('throws when __ASYAR_ROLE__ is undefined', async () => {
    setRole(undefined);
    await expect(import('./worker')).rejects.toThrow(/worker/i);
  });

  it('throws when __ASYAR_ROLE__ is a random string', async () => {
    setRole('garbage');
    await expect(import('./worker')).rejects.toThrow(/worker/i);
  });

  it('resolves when __ASYAR_ROLE__ is "worker"', async () => {
    setRole('worker');
    const mod = await import('./worker');
    expect(mod).toBeTruthy();
    expect(mod.ExtensionContext).toBeTypeOf('function');
  });
});

describe('asyar-sdk/worker — entry surface', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('ExtensionContext.proxies contains exactly the worker subset', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    const keys = Object.keys(ctx.proxies).sort();
    expect(keys).toEqual([...WORKER_PROXY_NAMESPACES].sort());
  });

  it('ExtensionContext.proxies has no view-only namespaces', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    for (const ns of VIEW_ONLY_NAMESPACES) {
      expect((ctx.proxies as any)[ns]).toBeUndefined();
    }
  });

  it('exposes preferences facade', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(ctx.preferences).toBeTruthy();
    expect(ctx.preferences.values).toBeDefined();
  });

  it('tags asyar:extension:loaded event with role=worker', async () => {
    const parentPostMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPostMessage },
      configurable: true,
    });
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    ctx.setExtensionId('ext.test');
    expect(parentPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'asyar:extension:loaded',
        extensionId: 'ext.test',
        role: 'worker',
      }),
      '*',
    );
  });
});
