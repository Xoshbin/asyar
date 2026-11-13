/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsServiceProxy } from './SettingsServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

/** A Web Worker has no `window` (node environment); its global is `self`. */
function stubWorkerGlobals() {
  const listeners = new Set<(event: MessageEvent) => void>();
  vi.stubGlobal('self', {
    postMessage: vi.fn(),
    addEventListener: (_type: string, cb: (event: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (event: MessageEvent) => void) => listeners.delete(cb),
  });
  const fire = (data: object) => listeners.forEach((cb) => cb({ data } as MessageEvent));
  return { listeners, fire };
}

describe('SettingsServiceProxy.onChanged inside a Web Worker', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('delivers settingsChanged events from self and unsubscribes cleanly', () => {
    const { fire, listeners } = stubWorkerGlobals();
    const proxy = new SettingsServiceProxy();
    const cb = vi.fn();

    const unsub = proxy.onChanged('appearance', cb);
    expect(listeners.size).toBe(1);

    fire({
      type: 'asyar:event:settingsChanged',
      section: 'appearance',
      payload: { theme: 'dark' },
    });
    fire({ type: 'asyar:event:settingsChanged', section: 'other', payload: { x: 1 } });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ theme: 'dark' });

    unsub();
    expect(listeners.size).toBe(0);
  });
});
