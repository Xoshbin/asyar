import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { invoke } from '@tauri-apps/api/core';
import { calculatorEvaluateForExtension } from './calculatorCommands';

describe('calculatorEvaluateForExtension', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty result list for an unrecognized expression', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    await expect(calculatorEvaluateForExtension('not math')).resolves.toEqual([]);
  });

  it('propagates Rust failures to the extension IPC response', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('calculator unavailable'));

    await expect(calculatorEvaluateForExtension('1 + 1')).rejects.toThrow('calculator unavailable');
  });
});
