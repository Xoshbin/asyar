import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../extension/extensionDispatcher.svelte', () => ({ dispatch: vi.fn() }));

import { listen } from '@tauri-apps/api/event';
import { dispatch } from '../extension/extensionDispatcher.svelte';
import { logService } from '../log/logService';
import { TimerBridge } from './timerBridge.svelte';

type FireHandler = (event: {
  payload: {
    extensionId: string;
    timerId: string;
    commandId: string;
    argsJson: string;
    fireAt: number;
    firedAt: number;
  };
}) => Promise<void> | void;

async function captureFireHandler(bridge: TimerBridge, deps: {
  isExtensionEnabled: (id: string) => boolean;
}): Promise<FireHandler> {
  let captured: FireHandler | undefined;
  vi.mocked(listen).mockImplementationOnce(async (_event, handler) => {
    captured = handler as unknown as FireHandler;
    return vi.fn();
  });
  await bridge.subscribe(deps);
  if (!captured) throw new Error('handler not captured');
  return captured;
}

describe('TimerBridge.subscribe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers a Tauri listener for asyar:timer:fire', async () => {
    const bridge = new TimerBridge();
    vi.mocked(listen).mockResolvedValueOnce(vi.fn());
    await bridge.subscribe({ isExtensionEnabled: () => true });
    expect(listen).toHaveBeenCalledWith('asyar:timer:fire', expect.any(Function));
  });
});

describe('TimerBridge fire handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards commandId and parsed args to the iframe manager', async () => {
    const bridge = new TimerBridge();
    const handler = await captureFireHandler(bridge, {
      isExtensionEnabled: () => true,
    });

    await handler({
      payload: {
        extensionId: 'my.ext',
        timerId: 't1',
        commandId: 'bell',
        argsJson: '{"snooze":300000}',
        fireAt: 2_000,
        firedAt: 2_001,
      },
    });

    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'my.ext',
      kind: 'command',
      payload: { commandId: 'bell', args: { snooze: 300_000 } },
      source: 'timer',
    });
  });

  it('passes empty args object when argsJson is "{}"', async () => {
    const bridge = new TimerBridge();
    const handler = await captureFireHandler(bridge, {
      isExtensionEnabled: () => true,
    });

    await handler({
      payload: {
        extensionId: 'my.ext',
        timerId: 't1',
        commandId: 'bell',
        argsJson: '{}',
        fireAt: 2_000,
        firedAt: 2_001,
      },
    });

    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'my.ext',
      kind: 'command',
      payload: { commandId: 'bell', args: {} },
      source: 'timer',
    });
  });

  it('does nothing when extension is disabled — firing into a torn-down iframe is worse than dropping', async () => {
    const bridge = new TimerBridge();
    const handler = await captureFireHandler(bridge, {
      isExtensionEnabled: () => false,
    });

    await handler({
      payload: {
        extensionId: 'my.ext',
        timerId: 't1',
        commandId: 'bell',
        argsJson: '{}',
        fireAt: 2_000,
        firedAt: 2_001,
      },
    });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('falls back to {} args on malformed argsJson and logs a warning', async () => {
    const bridge = new TimerBridge();
    const handler = await captureFireHandler(bridge, {
      isExtensionEnabled: () => true,
    });

    await handler({
      payload: {
        extensionId: 'my.ext',
        timerId: 't1',
        commandId: 'bell',
        argsJson: 'not-valid',
        fireAt: 2_000,
        firedAt: 2_001,
      },
    });

    expect(dispatch).toHaveBeenCalledWith({
      extensionId: 'my.ext',
      kind: 'command',
      payload: { commandId: 'bell', args: {} },
      source: 'timer',
    });
    expect(vi.mocked(logService.warn)).toHaveBeenCalledWith(
      expect.stringContaining('argsJson parse failed'),
    );
  });
});

describe('TimerBridge.unsubscribe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the stored unlisten function and nulls it out', async () => {
    const bridge = new TimerBridge();
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlisten);
    await bridge.subscribe({ isExtensionEnabled: () => true });

    bridge.unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);

    // Second unsubscribe is a no-op (handler already cleared)
    bridge.unsubscribe();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
