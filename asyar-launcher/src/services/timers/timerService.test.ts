import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { timerService } from './timerService';

describe('timerService.schedule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stringifies args before forwarding to the Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('timer-xyz');

    const id = await timerService.schedule('my.ext', {
      commandId: 'bell',
      fireAt: 1_700_000_000_000,
      args: { snooze: 300_000, note: 'water' },
    });

    expect(id).toBe('timer-xyz');
    expect(invoke).toHaveBeenCalledWith('timer_schedule', {
      extensionId: 'my.ext',
      commandId: 'bell',
      argsJson: '{"snooze":300000,"note":"water"}',
      fireAt: 1_700_000_000_000,
    });
  });

  it('defaults args to {} when the caller omits them', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('timer-a');
    await timerService.schedule('my.ext', { commandId: 'bell', fireAt: 2_000 });
    expect(invoke).toHaveBeenCalledWith('timer_schedule', {
      extensionId: 'my.ext',
      commandId: 'bell',
      argsJson: '{}',
      fireAt: 2_000,
    });
  });

  it('propagates Rust validation errors unchanged', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(
      new Error('Validation error: fire_at (100) must be strictly greater than now (2000)'),
    );
    await expect(
      timerService.schedule('my.ext', { commandId: 'bell', fireAt: 100 }),
    ).rejects.toThrow(/fire_at/);
  });
});

describe('timerService.cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards extensionId and timerId to the Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await timerService.cancel('my.ext', 'timer-abc');
    expect(invoke).toHaveBeenCalledWith('timer_cancel', {
      extensionId: 'my.ext',
      timerId: 'timer-abc',
    });
  });
});

describe('timerService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses argsJson back into a Record on each descriptor', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        timerId: 't1',
        extensionId: 'my.ext',
        commandId: 'bell',
        argsJson: '{"snooze":300000,"note":"water"}',
        fireAt: 1_700_000_000_000,
        createdAt: 1_699_999_000_000,
      },
    ]);

    const out = await timerService.list('my.ext');

    expect(invoke).toHaveBeenCalledWith('timer_list', { extensionId: 'my.ext' });
    expect(out).toEqual([
      {
        timerId: 't1',
        extensionId: 'my.ext',
        commandId: 'bell',
        args: { snooze: 300_000, note: 'water' },
        fireAt: 1_700_000_000_000,
        createdAt: 1_699_999_000_000,
      },
    ]);
  });

  it('returns empty args object when argsJson is "{}"', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        timerId: 't2',
        extensionId: 'my.ext',
        commandId: 'bell',
        argsJson: '{}',
        fireAt: 2_000,
        createdAt: 1_000,
      },
    ]);
    const out = await timerService.list('my.ext');
    expect(out[0].args).toEqual({});
  });

  it('falls back to {} when argsJson is malformed — the Rust side should never produce this, but UI must not crash', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      {
        timerId: 't3',
        extensionId: 'my.ext',
        commandId: 'bell',
        argsJson: 'not-valid-json',
        fireAt: 2_000,
        createdAt: 1_000,
      },
    ]);
    const out = await timerService.list('my.ext');
    expect(out[0].args).toEqual({});
  });

  it('returns an empty array unchanged', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    expect(await timerService.list('my.ext')).toEqual([]);
  });
});
