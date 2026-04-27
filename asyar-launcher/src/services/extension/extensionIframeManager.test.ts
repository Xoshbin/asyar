import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set up browser globals for Node environment
let mockPostMessage: ReturnType<typeof vi.fn>;
let mockIframe: any;

if (typeof document === 'undefined') {
  mockPostMessage = vi.fn();
  mockIframe = {
    contentWindow: { postMessage: mockPostMessage },
    dataset: { extensionId: 'org.asyar.tauri-docs' },
  };
  (global as any).document = {
    querySelector: vi.fn((selector: string) => {
      if (selector.includes('org.asyar.tauri-docs')) return mockIframe;
      return null;
    }),
    querySelectorAll: vi.fn().mockReturnValue([]),
  };
}

vi.mock('../../lib/ipc/extensionOrigin', () => ({
  getExtensionFrameOrigin: vi.fn((id: string) => `asyar-extension://${id}`)
}));
vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

import { ExtensionIframeManager } from './extensionIframeManager.svelte';

describe('ExtensionIframeManager', () => {
  let manager: ExtensionIframeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ExtensionIframeManager();

    // Reset the mock iframe's postMessage
    mockPostMessage = vi.fn();
    mockIframe.contentWindow = { postMessage: mockPostMessage };

    // Reset querySelector mock
    vi.mocked(document.querySelector).mockImplementation((selector: string) => {
      if (selector.includes('org.asyar.tauri-docs')) return mockIframe;
      return null;
    });
  });

  describe('sendViewSearchToExtension', () => {
    it('sends asyar:view:search message to the correct iframe', () => {
      manager.sendViewSearchToExtension('org.asyar.tauri-docs', 'prerequisites');

      // Selector carries [data-role="view"] first; falls back to worker, then
      // to unscoped, only if view is missing.
      expect(document.querySelector).toHaveBeenCalledWith(
        'iframe[data-extension-id="org.asyar.tauri-docs"][data-role="view"]'
      );
      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'asyar:view:search', payload: { query: 'prerequisites' } },
        'asyar-extension://org.asyar.tauri-docs'
      );
    });

    it('does nothing when iframe is not found', () => {
      manager.sendViewSearchToExtension('nonexistent-ext', 'query');

      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('forwards empty string query (clears search)', () => {
      manager.sendViewSearchToExtension('org.asyar.tauri-docs', '');

      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'asyar:view:search', payload: { query: '' } },
        'asyar-extension://org.asyar.tauri-docs'
      );
    });
  });

  describe('sendFilterChangeToView', () => {
    it('posts asyar:event:searchBar:filterChange to the view-role iframe', () => {
      manager.sendFilterChangeToView('org.asyar.tauri-docs', {
        commandId: 'cmd',
        value: 'images',
      });

      // Selector carries [data-role="view"] first; mirrors sendViewSearchToExtension.
      expect(document.querySelector).toHaveBeenCalledWith(
        'iframe[data-extension-id="org.asyar.tauri-docs"][data-role="view"]'
      );
      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: 'asyar:event:searchBar:filterChange',
          payload: { commandId: 'cmd', value: 'images' },
        },
        'asyar-extension://org.asyar.tauri-docs'
      );
    });

    it('no-ops when no view iframe is mounted for the extension', () => {
      expect(() =>
        manager.sendFilterChangeToView('missing-ext', {
          commandId: 'cmd',
          value: 'x',
        }),
      ).not.toThrow();
      expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('prefers view role over worker role', () => {
      const viewPost = vi.fn();
      const workerPost = vi.fn();
      const viewIframe = { contentWindow: { postMessage: viewPost }, dataset: { extensionId: 'ext-multi', role: 'view' } };
      const workerIframe = { contentWindow: { postMessage: workerPost }, dataset: { extensionId: 'ext-multi', role: 'worker' } };

      vi.mocked(document.querySelector).mockImplementation((selector: string) => {
        if (selector.includes('ext-multi') && selector.includes('[data-role="view"]')) return viewIframe as any;
        if (selector.includes('ext-multi') && selector.includes('[data-role="worker"]')) return workerIframe as any;
        return null;
      });

      manager.sendFilterChangeToView('ext-multi', {
        commandId: 'cmd',
        value: 'x',
      });

      expect(viewPost).toHaveBeenCalledTimes(1);
      expect(workerPost).not.toHaveBeenCalled();
    });
  });

  describe('handleExtensionSubmit', () => {
    it('sends asyar:view:submit message to the correct iframe', () => {
      manager.handleExtensionSubmit('org.asyar.tauri-docs', 'submit value');

      expect(mockPostMessage).toHaveBeenCalledWith(
        { type: 'asyar:view:submit', payload: { query: 'submit value' } },
        'asyar-extension://org.asyar.tauri-docs'
      );
    });

    it('does nothing when iframe is not found', () => {
      manager.handleExtensionSubmit('nonexistent-ext', 'query');

      expect(mockPostMessage).not.toHaveBeenCalled();
    });
  });

  describe('sendSearchRequestToExtension', () => {
    it('sends asyar:search:request and resolves empty when no iframe', async () => {
      const result = await manager.sendSearchRequestToExtension('nonexistent-ext', 'query');

      expect(result).toEqual([]);
    });

    it('sends asyar:search:request with unique messageId to iframe', async () => {
      // Don't await — the promise won't resolve until a response comes
      const promise = manager.sendSearchRequestToExtension('org.asyar.tauri-docs', 'tauri');

      expect(mockPostMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asyar:search:request',
          messageId: expect.stringContaining('search_'),
          payload: { query: 'tauri' },
        }),
        'asyar-extension://org.asyar.tauri-docs'
      );

      // Simulate response to clean up the pending request
      const sentMessageId = mockPostMessage.mock.calls[0][0].messageId;
      manager.handleSearchResponse({
        data: { type: 'asyar:search:response', messageId: sentMessageId, result: [{ title: 'Commands' }] }
      } as MessageEvent);

      const result = await promise;
      expect(result).toEqual([{ title: 'Commands' }]);
    });
  });

  describe('sendActionExecuteToExtension (role routing)', () => {
    // Set up separate view + worker iframes so we can observe which one got the post.
    let viewPostMessage: ReturnType<typeof vi.fn>
    let workerPostMessage: ReturnType<typeof vi.fn>
    let unscopedPostMessage: ReturnType<typeof vi.fn>

    beforeEach(() => {
      viewPostMessage = vi.fn()
      workerPostMessage = vi.fn()
      unscopedPostMessage = vi.fn()
      const viewIframe = { contentWindow: { postMessage: viewPostMessage }, dataset: { extensionId: 'ext-1', role: 'view' } }
      const workerIframe = { contentWindow: { postMessage: workerPostMessage }, dataset: { extensionId: 'ext-1', role: 'worker' } }
      const unscopedIframe = { contentWindow: { postMessage: unscopedPostMessage }, dataset: { extensionId: 'legacy-ext' } }

      vi.mocked(document.querySelector).mockImplementation((selector: string) => {
        if (selector.includes('ext-1') && selector.includes('[data-role="view"]')) return viewIframe as any
        if (selector.includes('ext-1') && selector.includes('[data-role="worker"]')) return workerIframe as any
        if (selector === 'iframe[data-extension-id="ext-1"]') return viewIframe as any
        if (selector === 'iframe[data-extension-id="legacy-ext"]') return unscopedIframe as any
        return null
      })
    })

    it('role="worker" routes asyar:action:execute to the worker iframe', () => {
      manager.sendActionExecuteToExtension('ext-1', 'send-notification', 'worker')
      expect(workerPostMessage).toHaveBeenCalledWith(
        { type: 'asyar:action:execute', payload: { actionId: 'send-notification' } },
        'asyar-extension://ext-1',
      )
      expect(viewPostMessage).not.toHaveBeenCalled()
    })

    it('role="view" routes asyar:action:execute to the view iframe', () => {
      manager.sendActionExecuteToExtension('ext-1', 'show-modal', 'view')
      expect(viewPostMessage).toHaveBeenCalledWith(
        { type: 'asyar:action:execute', payload: { actionId: 'show-modal' } },
        'asyar-extension://ext-1',
      )
      expect(workerPostMessage).not.toHaveBeenCalled()
    })

    it('no role: prefers view, falls back to worker (matches createPushBridge pattern)', () => {
      manager.sendActionExecuteToExtension('ext-1', 'some-action')
      expect(viewPostMessage).toHaveBeenCalledOnce()
      expect(workerPostMessage).not.toHaveBeenCalled()
    })

    it('legacy single-iframe extension (no role attr): falls back to unscoped selector', () => {
      manager.sendActionExecuteToExtension('legacy-ext', 'legacy-action')
      expect(unscopedPostMessage).toHaveBeenCalledWith(
        { type: 'asyar:action:execute', payload: { actionId: 'legacy-action' } },
        'asyar-extension://legacy-ext',
      )
    })
  })

  describe('handleSearchResponse', () => {
    it('ignores messages that are not asyar:search:response', () => {
      // Should not throw
      manager.handleSearchResponse({ data: { type: 'other:message' } } as MessageEvent);
      manager.handleSearchResponse({ data: null } as MessageEvent);
    });

    it('resolves with empty array on error response', async () => {
      const promise = manager.sendSearchRequestToExtension('org.asyar.tauri-docs', 'test');
      const sentMessageId = mockPostMessage.mock.calls[0][0].messageId;

      manager.handleSearchResponse({
        data: { type: 'asyar:search:response', messageId: sentMessageId, error: 'Search failed' }
      } as MessageEvent);

      const result = await promise;
      expect(result).toEqual([]);
    });
  });
});
