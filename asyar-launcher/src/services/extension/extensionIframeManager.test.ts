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

import { logService } from '../log/logService';

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

      expect(document.querySelector).toHaveBeenCalledWith(
        'iframe[data-extension-id="org.asyar.tauri-docs"]'
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

  describe('sendCommandExecuteToExtension', () => {
    it('sends asyar:command:execute message to iframe', () => {
      manager.sendCommandExecuteToExtension('org.asyar.tauri-docs', 'check-updates', { force: true });

      expect(mockPostMessage).toHaveBeenCalledWith(
        { 
          type: 'asyar:command:execute', 
          payload: { commandId: 'check-updates', args: { force: true } } 
        },
        'asyar-extension://org.asyar.tauri-docs'
      );
    });

    it('logs warning when iframe not found', () => {
      manager.sendCommandExecuteToExtension('missing-ext', 'cmd');
      
      expect(logService.warn).toHaveBeenCalledWith(
        expect.stringContaining('[IframeManager] No iframe found for missing-ext to execute command cmd')
      );
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
