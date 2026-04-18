import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { appEventsService } from './appEventsService';
import { invoke } from '@tauri-apps/api/core';

describe('appEventsService (host)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('subscribe forwards extensionId + eventTypes and returns the subscription id', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('sub-1');

    const id = await appEventsService.subscribe('ext-a', [
      'launched',
      'terminated',
      'frontmost-changed',
    ]);

    expect(id).toBe('sub-1');
    expect(invoke).toHaveBeenCalledWith('app_events_subscribe', {
      extensionId: 'ext-a',
      eventTypes: ['launched', 'terminated', 'frontmost-changed'],
    });
  });

  it('unsubscribe forwards extensionId + subscriptionId', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await appEventsService.unsubscribe('ext-a', 'sub-1');

    expect(invoke).toHaveBeenCalledWith('app_events_unsubscribe', {
      extensionId: 'ext-a',
      subscriptionId: 'sub-1',
    });
  });

  it('subscribe with null extensionId is forwarded (privileged host caller)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('sub-host');

    await appEventsService.subscribe(null, ['launched']);

    expect(invoke).toHaveBeenCalledWith('app_events_subscribe', {
      extensionId: null,
      eventTypes: ['launched'],
    });
  });

  // Regression: the ExtensionIpcRouter flattens the SDK payload via
  // `Object.values(payload)`, so service methods must take POSITIONAL args,
  // not a wrapper `{ eventTypes }` object. A prior revision of this service
  // accepted `(extensionId, { eventTypes })` and crashed with
  // "missing required key eventTypes" because the router passed the array
  // itself as the second arg.
  it('subscribe accepts positional eventTypes array (router shape)', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('sub-1');
    // Simulate the router: flatten `{ eventTypes: ['launched'] }` to
    // positional values and prepend extensionId.
    const routerFlattened: unknown[] = Object.values({ eventTypes: ['launched'] });
    await (appEventsService.subscribe as (...a: unknown[]) => Promise<string>)(
      'ext-a',
      ...routerFlattened,
    );
    expect(invoke).toHaveBeenCalledWith('app_events_subscribe', {
      extensionId: 'ext-a',
      eventTypes: ['launched'],
    });
  });
});
