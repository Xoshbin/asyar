import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { systemEventsService } from './systemEventsService';
import { invoke } from '@tauri-apps/api/core';

describe('systemEventsService (host)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribe forwards extensionId + eventTypes and returns the subscription id', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('sub-1');

    const id = await systemEventsService.subscribe('ext-a', ['wake', 'sleep']);

    expect(id).toBe('sub-1');
    expect(invoke).toHaveBeenCalledWith('system_events_subscribe', {
      extensionId: 'ext-a',
      eventTypes: ['wake', 'sleep'],
    });
  });

  it('unsubscribe forwards extensionId + subscriptionId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await systemEventsService.unsubscribe('ext-a', 'sub-1');

    expect(invoke).toHaveBeenCalledWith('system_events_unsubscribe', {
      extensionId: 'ext-a',
      subscriptionId: 'sub-1',
    });
  });

  it('subscribe with null extensionId is forwarded (privileged host caller)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('sub-host');

    await systemEventsService.subscribe(null, ['wake']);

    expect(invoke).toHaveBeenCalledWith('system_events_subscribe', {
      extensionId: null,
      eventTypes: ['wake'],
    });
  });
});
