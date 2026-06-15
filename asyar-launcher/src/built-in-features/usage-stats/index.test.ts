/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

vi.mock('../../lib/ipc/commands', () => ({
  getUsageStats: vi.fn().mockResolvedValue({
    activeDays: 1,
    totalLaunches: 7,
    top: [{ id: 'org.asyar.calculator', count: 7 }],
  }),
  sendUsageNow: vi.fn(),
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: { registerAction: vi.fn(), unregisterAction: vi.fn() },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

import { getUsageStats, sendUsageNow } from '../../lib/ipc/commands';
import { actionService } from '../../services/action/actionService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import extension from './index';

const mockRegister = actionService.registerAction as ReturnType<typeof vi.fn>;
const mockUnregister = actionService.unregisterAction as ReturnType<typeof vi.fn>;
const mockSendUsageNow = sendUsageNow as ReturnType<typeof vi.fn>;
const mockReport = diagnosticsService.report as ReturnType<typeof vi.fn>;

function mockContext() {
  return {
    getService: vi.fn((name: string) => {
      if (name === 'log') return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
      if (name === 'extensions') return { navigateToView: vi.fn(), setActiveViewActionLabel: vi.fn() };
      return null;
    }),
  };
}

describe('UsageStatsExtension', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the view and loads stats on the open-usage-stats command', async () => {
    await extension.initialize(mockContext() as any);
    const result = await extension.executeCommand('open-usage-stats');
    expect(result.type).toBe('view');
    expect(result.viewPath).toBe('usage-stats/DefaultView');
    expect(getUsageStats).toHaveBeenCalled();
  });

  it('throws on an unknown command', async () => {
    await extension.initialize(mockContext() as any);
    await expect(extension.executeCommand('nope')).rejects.toThrow();
  });

  it('registers the "Send usage now" view action scoped to usage-stats', async () => {
    await (extension as any).viewActivated('usage-stats/DefaultView');
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const action = mockRegister.mock.calls[0][0];
    expect(action.id).toBe('usage-stats:send-now');
    expect(action.title).toBe('Send usage now');
    expect(action.extensionId).toBe('usage-stats');
    expect(action.context).toBe('extension_view');
  });

  it('unregisters the action on view deactivation', async () => {
    await (extension as any).viewDeactivated('usage-stats/DefaultView');
    expect(mockUnregister).toHaveBeenCalledWith('usage-stats:send-now');
  });

  it('action sends usage and reports success with the event count', async () => {
    mockSendUsageNow.mockResolvedValue(3);
    await (extension as any).viewActivated('usage-stats/DefaultView');
    const action = mockRegister.mock.calls[0][0];
    await action.execute();
    expect(mockSendUsageNow).toHaveBeenCalled();
    const d = mockReport.mock.calls[0][0];
    expect(d.severity).toBe('success');
    expect(d.context.message).toBe('Usage sent (3 events)');
  });

  it('action reports an error when the send fails', async () => {
    mockSendUsageNow.mockRejectedValue(new Error('network down'));
    await (extension as any).viewActivated('usage-stats/DefaultView');
    const action = mockRegister.mock.calls[0][0];
    await action.execute();
    const d = mockReport.mock.calls[0][0];
    expect(d.severity).toBe('error');
    expect(d.developerDetail).toContain('network down');
  });
});
