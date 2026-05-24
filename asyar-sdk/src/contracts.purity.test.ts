/**
 * @vitest-environment node
 *
 * Contracts purity: importing asyar-sdk/contracts in a bare Node harness
 * (no DOM, no window, no __ASYAR_ROLE__) must resolve without throwing.
 * This is the mechanical guarantee that the launcher (Tier 1 host, not in
 * an iframe) and downstream tools can consume the SDK surface without
 * triggering role-assertion side effects.
 */
import { describe, it, expect } from 'vitest';

describe('asyar-sdk/contracts — purity', () => {
  it('imports cleanly in a bare Node environment', async () => {
    expect(typeof (globalThis as any).window).toBe('undefined');
    await expect(import('./contracts')).resolves.toBeTruthy();
  });

  it('re-exports NAMESPACES and messageBroker', async () => {
    const mod = await import('./contracts');
    expect(Array.isArray(mod.NAMESPACES)).toBe(true);
    expect(mod.messageBroker).toBeTruthy();
    expect(typeof mod.messageBroker.invoke).toBe('function');
  });

  it('re-exports extensionBridge and ExtensionContext class', async () => {
    const mod = await import('./contracts');
    expect(mod.extensionBridge).toBeTruthy();
    expect(typeof mod.ExtensionContext).toBe('function');
  });

  it('has no top-level role assertion', async () => {
    // If contracts were to assert role, this import would throw in Node.
    const mod = await import('./contracts');
    expect(mod).toBeTruthy();
  });
});
