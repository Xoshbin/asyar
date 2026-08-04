import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./invokeSafe', () => ({
  invokeRaw: vi.fn(),
}));

import { invokeRaw } from './invokeSafe';
import { resolveCommandArguments } from './argumentModelCommands';
import type { ArgumentModelResolution, ResolveArgumentModelRequest } from './argumentModelCommands';

describe('resolveCommandArguments', () => {
  it('invokes resolve_command_arguments with the request under the "request" key', async () => {
    const resolution: ArgumentModelResolution = {
      seeds: {},
      seededFromUser: [],
      lastUsedFields: [],
      userSupplied: {},
      acknowledged: {},
      unfilledRequiredVisible: [],
      unfilledRequired: [],
      unfilledRequiredAcknowledged: [],
      requireAnyOfUnsatisfied: false,
      payload: {},
    };
    vi.mocked(invokeRaw).mockResolvedValueOnce(resolution);

    const request: ResolveArgumentModelRequest = {
      args: [{ name: 'q', type: 'text' }],
      values: { q: 'hello' },
    };
    const result = await resolveCommandArguments(request);

    expect(invokeRaw).toHaveBeenCalledWith('resolve_command_arguments', { request });
    expect(result).toBe(resolution);
  });

  it('propagates a rejection so the caller can decide how to handle it', async () => {
    vi.mocked(invokeRaw).mockRejectedValueOnce(new Error('boom'));

    await expect(resolveCommandArguments({ args: [], values: {} })).rejects.toThrow('boom');
  });
});
