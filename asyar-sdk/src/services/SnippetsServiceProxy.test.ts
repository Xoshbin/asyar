import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SnippetsServiceProxy } from './SnippetsServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';
import type { ShortcodeMap } from '../contracts/snippets';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), off: vi.fn() },
}));

function makeProxy() {
  const invoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, { invoke, on: vi.fn(), off: vi.fn() });
  const proxy = new SnippetsServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, invoke };
}

describe('SnippetsServiceProxy', () => {
  let proxy: SnippetsServiceProxy;
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ proxy, invoke } = makeProxy());
  });

  it('dispatches registerShortcodes via snippets:registerShortcodes topic', async () => {
    const map: ShortcodeMap = { ':party:': '🎉', ':fire:': '🔥' };
    await proxy.registerShortcodes(map);
    // this.invoke stamps the extensionId structurally as the third arg.
    expect(invoke).toHaveBeenCalledWith(
      'snippets:registerShortcodes',
      { map },
      'ext.test',
      undefined,
    );
  });

  it('dispatches unregisterShortcodes via snippets:unregisterShortcodes topic', async () => {
    await proxy.unregisterShortcodes();
    expect(invoke).toHaveBeenCalledWith('snippets:unregisterShortcodes', {}, 'ext.test', undefined);
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
    expect(invoke).toHaveBeenCalledWith(
      'snippets:registerShortcodes',
      { map: {} },
      'ext.test',
      undefined,
    );
  });
});
