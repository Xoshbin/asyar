import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnippetsServiceProxy } from './SnippetsServiceProxy';
import type { ShortcodeMap } from '../contracts/snippets';

function buildProxyWithMockBroker() {
  const invoke = vi.fn().mockResolvedValue(undefined);
  const proxy = new SnippetsServiceProxy();
  (proxy as unknown as { broker: { invoke: typeof invoke } }).broker = { invoke } as never;
  return { proxy, invoke };
}

describe('SnippetsServiceProxy', () => {
  let proxy: SnippetsServiceProxy;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ proxy, invoke } = buildProxyWithMockBroker());
  });

  it('dispatches registerShortcodes via snippets:registerShortcodes topic', async () => {
    const map: ShortcodeMap = { ':party:': '🎉', ':fire:': '🔥' };
    await proxy.registerShortcodes(map);
    expect(invoke).toHaveBeenCalledWith('snippets:registerShortcodes', { map });
  });

  it('dispatches unregisterShortcodes via snippets:unregisterShortcodes topic', async () => {
    await proxy.unregisterShortcodes();
    expect(invoke).toHaveBeenCalledWith('snippets:unregisterShortcodes', {});
  });

  it('rejects malformed keys without dispatching', async () => {
    const bad: ShortcodeMap = { ':Party:': '🎉' };
    await expect(proxy.registerShortcodes(bad)).rejects.toThrow(/snippets:contract/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects empty expansion strings without dispatching', async () => {
    const bad: ShortcodeMap = { ':party:': '' };
    await expect(proxy.registerShortcodes(bad)).rejects.toThrow(/snippets:contract/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('accepts an empty map (replaces previous contribution with nothing)', async () => {
    await proxy.registerShortcodes({});
    expect(invoke).toHaveBeenCalledWith('snippets:registerShortcodes', { map: {} });
  });
});
