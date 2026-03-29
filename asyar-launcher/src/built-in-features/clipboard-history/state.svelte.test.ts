import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies BEFORE importing the module under test
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
}))

import { ClipboardViewStateClass } from './state.svelte'

describe('ClipboardViewStateClass paste action proxy issue', () => {
    let state: ClipboardViewStateClass;
    let mockClipboardService: any;
    let mockLogService: any;

    beforeEach(() => {
        state = new ClipboardViewStateClass();
        mockClipboardService = {
            pasteItem: vi.fn().mockResolvedValue(true),
            hideWindow: vi.fn(),
            getRecentItems: vi.fn().mockResolvedValue([]),
        };
        mockLogService = {
            error: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        };
        
        const context = {
            getService: (name: string) => {
                if (name === "ClipboardHistoryService") return mockClipboardService;
                if (name === "LogService") return mockLogService;
                return null;
            }
        };
        state.initializeServices(context as any);
    });

    it('should paste item without Proxy wrapper (fails if Proxy passed)', async () => {
        const item = { id: '1', content: 'test content' };
        
        // Manual proxy to simulate Svelte 5 reactive state behavior in Vitest node environment
        // since $state doesn't automatically wrap items in this test setup
        const reactiveProxy = new Proxy(item, {});
        
        await state.handleItemAction(reactiveProxy as any, 'paste');

        expect(mockClipboardService.pasteItem).toHaveBeenCalled();
        const arg = mockClipboardService.pasteItem.mock.calls[0][0];

        // This expectation will FAIL (RED) if we pass the proxy directly because 
        // structuredClone(proxy) throws.
        // This simulates the actual bug where SDK fails to clone it for postMessage.
        expect(() => structuredClone(arg)).not.toThrow();
    });
});
