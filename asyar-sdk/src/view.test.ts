/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const VIEW_PROXY_NAMESPACES = [
  'log',
  'notifications',
  'clipboard',
  'extensions',
  'commands',
  'actions',
  'network',
  'settings',
  'statusBar',
  'entitlements',
  'storage',
  'feedback',
  'selection',
  'ai',
  'oauth',
  'shell',
  'fs',
  'interop',
  'cache',
  'application',
  'window',
  'power',
  'process',
  'systemEvents',
  'timers',
  'state',
  'diagnostics',
  'onboarding',
  'browser',
] as const;

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

describe('asyar-sdk/view — import-time role assertion', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('throws when __ASYAR_ROLE__ is "worker"', async () => {
    setRole('worker');
    await expect(import('./view')).rejects.toThrow(/view/i);
  });

  it('throws when __ASYAR_ROLE__ is undefined', async () => {
    setRole(undefined);
    await expect(import('./view')).rejects.toThrow(/view/i);
  });

  it('throws when __ASYAR_ROLE__ is a random string', async () => {
    setRole('garbage');
    await expect(import('./view')).rejects.toThrow(/view/i);
  });

  it('resolves when __ASYAR_ROLE__ is "view"', async () => {
    setRole('view');
    const mod = await import('./view');
    expect(mod).toBeTruthy();
    expect(mod.ExtensionContext).toBeTypeOf('function');
  });
});

describe('asyar-sdk/view — entry surface', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('view');
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('ExtensionContext.proxies contains the full view subset', async () => {
    const { ExtensionContext } = await import('./view');
    const ctx = new ExtensionContext();
    const keys = Object.keys(ctx.proxies).sort();
    expect(keys).toEqual([...VIEW_PROXY_NAMESPACES].sort());
  });

  it('exposes DOM-capable helpers (registerIconElement)', async () => {
    const mod = await import('./view');
    expect(mod.registerIconElement).toBeTypeOf('function');
  });

  it('exposes request but not onRequest (view-only RPC direction)', async () => {
    const { ExtensionContext } = await import('./view');
    const ctx = new ExtensionContext();
    expect((ctx as unknown as { request?: unknown }).request).toBeTypeOf('function');
    expect((ctx as unknown as { onRequest?: unknown }).onRequest).toBeUndefined();
  });

  it('getService("fsWatcher") throws — fs-watch is worker-only', async () => {
    const { ExtensionContext } = await import('./view');
    const ctx = new ExtensionContext();
    expect(() => ctx.getService('fsWatcher')).toThrow(/fsWatcher/);
  });

  it('tags asyar:extension:loaded event with role=view', async () => {
    const parentPostMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: parentPostMessage },
      configurable: true,
    });
    const { ExtensionContext } = await import('./view');
    const ctx = new ExtensionContext();
    ctx.setExtensionId('ext.test');
    expect(parentPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'asyar:extension:loaded',
        extensionId: 'ext.test',
        role: 'view',
      }),
      '*',
    );
  });
});
