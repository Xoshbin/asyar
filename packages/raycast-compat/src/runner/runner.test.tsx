/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { screen, cleanup, waitFor } from '@testing-library/react';
import { mountRaycastView, resolveActiveCommandName, startWorkerRunner } from './index';

describe('Raycast Runner', () => {
  let mockParent: { postMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    cleanup();
    document.body.innerHTML = '';
    mockParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', {
      value: mockParent,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  describe('resolveActiveCommandName', () => {
    it('resolves requested view from ?view= parameter', () => {
      const result = resolveActiveCommandName('?view=search&filter=all', [
        'index',
        'search',
        'settings',
      ]);
      expect(result).toBe('search');
    });

    it('resolves requested component from ?component= parameter', () => {
      const result = resolveActiveCommandName('?component=settings', [
        'index',
        'search',
        'settings',
      ]);
      expect(result).toBe('settings');
    });

    it('falls back to fallbackCommand if requested command is unknown', () => {
      const result = resolveActiveCommandName('?view=unknown', ['index', 'search'], 'index');
      expect(result).toBe('index');
    });

    it('falls back to the first available command if no params and no fallback', () => {
      const result = resolveActiveCommandName('', ['main', 'auxiliary']);
      expect(result).toBe('main');
    });
  });

  describe('mountRaycastView', () => {
    it('mounts the active command component into #root', async () => {
      const IndexCmd = (props: { arguments?: Record<string, unknown> }) => (
        <div data-testid="index-cmd">Index Command {props.arguments?.query as string}</div>
      );
      const SearchCmd = () => <div data-testid="search-cmd">Search Command</div>;

      // Mock search query
      delete (window as any).location;
      window.location = new URL('https://example.com/view.html?view=index&query=test') as any;

      await act(async () => {
        mountRaycastView({
          index: IndexCmd,
          search: SearchCmd,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('index-cmd')).toBeDefined();
        expect(screen.getByText(/Index Command test/)).toBeDefined();
      });

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'asyar:extension:loaded', role: 'view' }),
        '*',
      );
    });

    it('shows placeholder when no matching command is found', async () => {
      delete (window as any).location;
      window.location = new URL('https://example.com/view.html?view=missing') as any;

      await act(async () => {
        mountRaycastView({});
      });

      await waitFor(() => {
        expect(screen.getByTestId('raycast-no-command')).toBeDefined();
        expect(screen.getByText(/No view command found/)).toBeDefined();
      });
    });

    it('catches render errors in ErrorBoundary and reports to parent', async () => {
      const BrokenCmd = () => {
        throw new Error('Explosion during render!');
      };

      delete (window as any).location;
      window.location = new URL('https://example.com/view.html?view=broken') as any;

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorHandler = (e: ErrorEvent) => e.preventDefault();
      window.addEventListener('error', errorHandler);

      try {
        await act(async () => {
          mountRaycastView({
            broken: BrokenCmd,
          });
        });
      } catch {
        // React in dev mode re-throws uncaught component errors from act()
      }

      expect(screen.getByTestId('raycast-error-boundary')).toBeDefined();
      expect(screen.getAllByText(/Explosion during render/).length).toBeGreaterThanOrEqual(1);

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asyar:feedback:uncaught',
          payload: expect.objectContaining({
            kind: 'iframe_uncaught',
            developerDetail: expect.stringContaining('Explosion during render!'),
          }),
        }),
        '*',
      );

      window.removeEventListener('error', errorHandler);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('startWorkerRunner', () => {
    it('registers background commands and executes them on request', async () => {
      const quickGenHandler = vi.fn().mockResolvedValue('generated-uuid-1234');

      const handle = startWorkerRunner({
        manifest: {
          id: 'org.asyar.test-ext',
          name: 'Test Ext',
          version: '1.0.0',
        } as any,
        commands: {
          'quick-generate': quickGenHandler,
        },
      });

      expect(mockParent.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'asyar:extension:loaded',
          extensionId: 'org.asyar.test-ext',
          role: 'worker',
        }),
        '*',
      );

      const result = await handle.executeCommand('quick-generate', { format: 'v4' });
      expect(result).toBe('generated-uuid-1234');
      expect(quickGenHandler).toHaveBeenCalledWith({
        arguments: { format: 'v4' },
      });
    });

    it('throws when requested command is not registered', async () => {
      const handle = startWorkerRunner({
        commands: {
          ping: () => 'pong',
        },
      });

      await expect(handle.executeCommand('nonexistent')).rejects.toThrow(
        /Command 'nonexistent' not found/,
      );
    });
  });
});
