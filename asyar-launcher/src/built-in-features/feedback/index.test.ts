/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

import extension from './index';

function mockContext() {
  return {
    getService: vi.fn((name: string) => {
      if (name === 'log') return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      if (name === 'extensions') return { navigateToView: vi.fn(), setActiveViewActionLabel: vi.fn() };
      return null;
    }),
  };
}

describe('FeedbackExtension', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the feedback view on the send-feedback command', async () => {
    await extension.initialize(mockContext() as any);
    const result = await extension.executeCommand('send-feedback');
    expect(result.type).toBe('view');
    expect(result.viewPath).toBe('feedback/DefaultView');
  });

  it('throws on an unknown command', async () => {
    await extension.initialize(mockContext() as any);
    await expect(extension.executeCommand('nope')).rejects.toThrow();
  });
});
