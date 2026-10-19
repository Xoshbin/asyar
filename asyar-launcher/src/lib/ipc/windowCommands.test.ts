import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmit } = vi.hoisted(() => ({
  mockEmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: mockEmit,
}));

vi.mock('./invokeSafe', () => ({
  invokeSafe: vi.fn(),
}));

import { openCreateExtension, openCreateExtensionWithAi, openStore } from './windowCommands';

describe('extension navigation commands from settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('openStore emits asyar:deeplink:extension for store browse', async () => {
    await openStore();

    expect(mockEmit).toHaveBeenCalledWith('asyar:deeplink:extension', {
      extensionId: 'store',
      commandId: 'browse',
      args: {},
    });
  });

  it('openCreateExtensionWithAi emits asyar:deeplink:extension for AI builder', async () => {
    await openCreateExtensionWithAi();

    expect(mockEmit).toHaveBeenCalledWith('asyar:deeplink:extension', {
      extensionId: 'create-extension',
      commandId: 'build-with-ai',
      args: {},
    });
  });

  it('openCreateExtension emits asyar:deeplink:extension for scaffold open', async () => {
    await openCreateExtension();

    expect(mockEmit).toHaveBeenCalledWith('asyar:deeplink:extension', {
      extensionId: 'create-extension',
      commandId: 'open',
      args: {},
    });
  });
});
