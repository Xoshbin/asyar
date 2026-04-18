import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { NotificationActionBridge } from './notificationActionBridge.svelte';

function makeBridge(overrides: Partial<Parameters<typeof NotificationActionBridge.prototype.handle>[0]> = {}) {
  const deps = {
    getManifestById: vi.fn().mockReturnValue({ id: 'coffee' }),
    isExtensionEnabled: vi.fn().mockReturnValue(true),
    hasCommand: vi.fn().mockReturnValue(true),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  };
  const bridge = new NotificationActionBridge(deps);
  return { bridge, deps };
}

const coffeeEnvelope = {
  notificationId: 'notif-1',
  actionId: 'extend',
  extensionId: 'coffee',
  commandId: 'coffee.extend',
  argsJson: '{"minutes":30}',
};

beforeEach(() => vi.clearAllMocks());

describe('NotificationActionBridge.handle', () => {
  it('dispatches the extension command with parsed args', async () => {
    const { bridge, deps } = makeBridge();
    await bridge.handle(coffeeEnvelope);
    expect(deps.executeCommand).toHaveBeenCalledWith('cmd_coffee_coffee.extend', { minutes: 30 });
  });

  it('drops actions whose extension is not installed', async () => {
    const { bridge, deps } = makeBridge();
    deps.getManifestById.mockReturnValueOnce(undefined);
    await bridge.handle(coffeeEnvelope);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('drops actions whose extension is disabled', async () => {
    const { bridge, deps } = makeBridge();
    deps.isExtensionEnabled.mockReturnValueOnce(false);
    await bridge.handle(coffeeEnvelope);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('drops actions whose command is not registered', async () => {
    const { bridge, deps } = makeBridge();
    deps.hasCommand.mockReturnValueOnce(false);
    await bridge.handle(coffeeEnvelope);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('dispatches with undefined args when argsJson is missing', async () => {
    const { bridge, deps } = makeBridge();
    await bridge.handle({ ...coffeeEnvelope, argsJson: undefined });
    expect(deps.executeCommand).toHaveBeenCalledWith('cmd_coffee_coffee.extend', undefined);
  });

  it('dispatches with undefined args when argsJson fails to parse', async () => {
    const { bridge, deps } = makeBridge();
    await bridge.handle({ ...coffeeEnvelope, argsJson: 'not-json' });
    expect(deps.executeCommand).toHaveBeenCalledWith('cmd_coffee_coffee.extend', undefined);
  });

  it('builds objectId from extensionId + commandId', async () => {
    const { bridge, deps } = makeBridge();
    await bridge.handle({ ...coffeeEnvelope, extensionId: 'org.x', commandId: 'run' });
    expect(deps.executeCommand).toHaveBeenCalledWith('cmd_org.x_run', { minutes: 30 });
  });
});
