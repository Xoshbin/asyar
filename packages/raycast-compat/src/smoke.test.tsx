/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { screen, waitFor, cleanup } from '@testing-library/react';
import { ClipboardItemType } from 'asyar-sdk/contracts';
import { setRaycastContext } from './context.js';
import { mountRaycastView, startWorkerRunner } from './runner/index.js';

// Import real-world Raycast base64 extension source files
import Base64View from '../../../extensions/raycast-base64/src/index.js';
import encodeCommand from '../../../extensions/raycast-base64/src/encode.js';
import decodeCommand from '../../../extensions/raycast-base64/src/decode.js';

describe('Real-World Raycast Extension Smoke Test (base64)', () => {
  let mockParent: { postMessage: ReturnType<typeof vi.fn> };
  let mockClipboardService: {
    writeToClipboard: ReturnType<typeof vi.fn>;
    readCurrentClipboard: ReturnType<typeof vi.fn>;
    readCurrentText: ReturnType<typeof vi.fn>;
    simulatePaste: ReturnType<typeof vi.fn>;
  };
  let mockFeedbackService: {
    report: ReturnType<typeof vi.fn>;
    showProgress: ReturnType<typeof vi.fn>;
  };
  let writtenItems: any[] = [];
  let reportedFeedbacks: any[] = [];

  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    mockParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      value: mockParent,
      writable: true,
      configurable: true,
    });

    writtenItems = [];
    reportedFeedbacks = [];

    mockClipboardService = {
      writeToClipboard: vi.fn().mockImplementation(async (item) => {
        writtenItems.push(item);
      }),
      readCurrentClipboard: vi.fn().mockResolvedValue({
        type: ClipboardItemType.Text,
        content: 'Hello Asyar',
      }),
      readCurrentText: vi.fn().mockResolvedValue('Hello Asyar'),
      simulatePaste: vi.fn().mockResolvedValue(true),
    };

    mockFeedbackService = {
      report: vi.fn().mockImplementation(async (feedback) => {
        reportedFeedbacks.push(feedback);
        return { id: 'fb-1' };
      }),
      showProgress: vi.fn(),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'clipboard') return mockClipboardService;
        if (ns === 'feedback') return mockFeedbackService;
        return {};
      }),
    } as any);

    (window as any).__ASYAR_PREFERENCES__ = {
      defaultAction: 'copyToClipboard',
    };
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    setRaycastContext(undefined);
    vi.restoreAllMocks();
  });

  it('renders the real-world Raycast Base64 view command and encodes clipboard contents', async () => {
    await act(async () => {
      mountRaycastView({
        index: Base64View,
      });
    });

    // Wait for the asynchronous Clipboard.read() and usePromise hook to settle
    await waitFor(() => {
      expect(document.querySelector('.asyar-raycast-list-container')).not.toBeNull();
    });

    // Handshake sent to host
    expect(mockParent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'asyar:extension:loaded' }),
      '*',
    );

    // Search bar placeholder check
    const searchInput = document.querySelector('input[placeholder="Text to encode / decode..."]');
    expect(searchInput).not.toBeNull();

    // Verify Base64 encoded item rendered for "Hello Asyar" -> "SGVsbG8gQXN5YXI="
    await waitFor(() => {
      const text = document.body.textContent || '';
      expect(text).toContain('Encode');
      expect(text).toContain('SGVsbG8gQXN5YXI=');
    });
  });

  it('executes background encode command: reads clipboard, encodes, writes back, closes window, and toasts', async () => {
    await encodeCommand();

    // 1. Should have read clipboard ("Hello Asyar") and written encoded base64 ("SGVsbG8gQXN5YXI=")
    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: 'SGVsbG8gQXN5YXI=',
      }),
    );

    // 2. Should have requested closeMainWindow (posted asyar:window:hide to parent)
    expect(mockParent.postMessage).toHaveBeenCalledWith({ type: 'asyar:window:hide' }, '*');

    // 3. Should have shown success toast
    expect(mockFeedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        context: { title: 'Copied to clipboard' },
      }),
    );
  });

  it('executes background decode command: decodes Base64 clipboard and writes back plaintext', async () => {
    // Set clipboard to Base64 encoded string
    mockClipboardService.readCurrentClipboard.mockResolvedValueOnce({
      type: ClipboardItemType.Text,
      content: 'SGVsbG8gQXN5YXI=',
    });

    await decodeCommand();

    // Should have decoded "SGVsbG8gQXN5YXI=" -> "Hello Asyar"
    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClipboardItemType.Text,
        content: 'Hello Asyar',
      }),
    );

    // Should have closed window and notified
    expect(mockParent.postMessage).toHaveBeenCalledWith({ type: 'asyar:window:hide' }, '*');
    expect(mockFeedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        context: { title: 'Copied to clipboard' },
      }),
    );
  });

  it('integrates background commands through startWorkerRunner execution handle', async () => {
    const handle = startWorkerRunner({
      manifest: {
        id: 'org.asyar.raycast.base64',
        name: 'Base64',
        version: '1.0.0',
        commands: [
          { id: 'encode', mode: 'background' },
          { id: 'decode', mode: 'background' },
        ],
      } as any,
      commands: {
        encode: encodeCommand,
        decode: decodeCommand,
      },
    });

    // Execute 'encode' via the runner handle
    await handle.executeCommand('encode');

    expect(mockClipboardService.writeToClipboard).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'SGVsbG8gQXN5YXI=',
      }),
    );
  });
});
