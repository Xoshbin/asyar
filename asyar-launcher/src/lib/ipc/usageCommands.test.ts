import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import {
  getUsageStats,
  recordActiveDay,
  getUsageAnonId,
  resetUsageAnonId,
  sendPendingUsage,
  sendUsageNow,
} from './commands';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUsageStats', () => {
  it('calls invoke with get_usage_stats', async () => {
    mockInvoke.mockResolvedValue({ activeDays: 3, totalLaunches: 42, top: [] });
    await getUsageStats();
    expect(mockInvoke).toHaveBeenCalledWith('get_usage_stats');
  });

  it('returns the UsageStats payload', async () => {
    const expected = { activeDays: 5, totalLaunches: 100, top: [{ id: 'calc', count: 10 }] };
    mockInvoke.mockResolvedValue(expected);
    const result = await getUsageStats();
    expect(result).toEqual(expected);
  });
});

describe('recordActiveDay', () => {
  it('calls invoke with record_active_day', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await recordActiveDay();
    expect(mockInvoke).toHaveBeenCalledWith('record_active_day');
  });
});

describe('getUsageAnonId', () => {
  it('calls invoke with get_usage_anon_id', async () => {
    mockInvoke.mockResolvedValue('some-uuid');
    await getUsageAnonId();
    expect(mockInvoke).toHaveBeenCalledWith('get_usage_anon_id');
  });

  it('returns the anon id string', async () => {
    mockInvoke.mockResolvedValue('abc-123');
    const result = await getUsageAnonId();
    expect(result).toBe('abc-123');
  });
});

describe('resetUsageAnonId', () => {
  it('calls invoke with reset_usage_anon_id', async () => {
    mockInvoke.mockResolvedValue('new-uuid');
    await resetUsageAnonId();
    expect(mockInvoke).toHaveBeenCalledWith('reset_usage_anon_id');
  });

  it('returns the new anon id string', async () => {
    mockInvoke.mockResolvedValue('new-uuid-456');
    const result = await resetUsageAnonId();
    expect(result).toBe('new-uuid-456');
  });
});

describe('sendPendingUsage', () => {
  it('calls invoke with send_pending_usage and the day arg', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await sendPendingUsage('2026-06-15');
    expect(mockInvoke).toHaveBeenCalledWith('send_pending_usage', { day: '2026-06-15' });
  });
});

describe('sendUsageNow', () => {
  it('calls invoke with send_usage_now', async () => {
    mockInvoke.mockResolvedValue(0);
    await sendUsageNow();
    expect(mockInvoke).toHaveBeenCalledWith('send_usage_now');
  });

  it('returns the number of events sent', async () => {
    mockInvoke.mockResolvedValue(7);
    const result = await sendUsageNow();
    expect(result).toBe(7);
  });
});
