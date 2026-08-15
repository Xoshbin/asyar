// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../extension/extensionIframeSelector', () => ({ pickExtensionIframe: vi.fn() }));
vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn(() => 'app://ext'),
}));

import { listen } from '@tauri-apps/api/event';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { pickExtensionIframe } from '../extension/extensionIframeSelector';
import { networkWsPushBridge } from './networkWsPushBridge.svelte';

describe('networkWsPushBridge', () => {
  beforeEach(() => {
    networkWsPushBridge.dispose();
    vi.clearAllMocks();
  });

  it('delivers a socket event only to its originating iframe role', async () => {
    const postMessage = vi.fn();
    vi.mocked(pickExtensionIframe).mockReturnValue({
      contentWindow: { postMessage },
    } as unknown as HTMLIFrameElement);

    let handler: ((event: { payload: unknown }) => void) | undefined;
    vi.mocked(listen).mockImplementationOnce(async (_event, callback) => {
      handler = callback as typeof handler;
      return vi.fn();
    });

    await networkWsPushBridge.init();
    handler?.({
      payload: {
        socket_id: 'socket-1',
        extension_id: 'org.example.extension',
        origin_role: 'worker',
        event_type: 'message',
        data: 'hello',
      },
    });

    expect(pickExtensionIframe).toHaveBeenCalledWith('org.example.extension', 'worker', {
      fallback: false,
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'asyar:event:network:wsMessage:push',
        payload: expect.objectContaining({ socket_id: 'socket-1', origin_role: 'worker' }),
      },
      'app://ext',
    );
    expect(getExtensionFrameOrigin).toHaveBeenCalledWith('org.example.extension');
  });
});
