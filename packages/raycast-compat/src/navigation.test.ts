import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { open, closeMainWindow, popToRoot } from './navigation';
import { setRaycastContext } from './context';
import type { IOpenerService } from 'asyar-sdk/contracts';

describe('Navigation and window management compat API', () => {
  let mockOpenerService: Partial<IOpenerService>;
  let postedMessages: any[] = [];
  let originalWindow: any;

  beforeEach(() => {
    postedMessages = [];
    mockOpenerService = {
      openUrl: vi.fn().mockResolvedValue(undefined),
      openPath: vi.fn().mockResolvedValue(undefined),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'opener') return mockOpenerService;
        throw new Error(`Unknown service ${ns}`);
      }),
      hideLauncher: vi.fn(),
    } as any);

    originalWindow = globalThis.window;
    (globalThis as any).window = {
      parent: {
        postMessage: vi.fn().mockImplementation((msg: any) => {
          postedMessages.push(msg);
        }),
      },
    };
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it('opens web URLs using opener.openUrl', async () => {
    await open('https://asyar.org');
    expect(mockOpenerService.openUrl).toHaveBeenCalledWith('https://asyar.org');
    expect(mockOpenerService.openPath).not.toHaveBeenCalled();
  });

  it('opens mailto and custom protocol URLs using opener.openUrl', async () => {
    await open('mailto:dev@asyar.org');
    expect(mockOpenerService.openUrl).toHaveBeenCalledWith('mailto:dev@asyar.org');
  });

  it('opens local file paths using opener.openPath', async () => {
    await open('/Users/test/document.pdf');
    expect(mockOpenerService.openPath).toHaveBeenCalledWith('/Users/test/document.pdf', undefined);
  });

  it('opens local file paths with target application options', async () => {
    await open('/Users/test/document.pdf', 'Preview');
    expect(mockOpenerService.openPath).toHaveBeenCalledWith('/Users/test/document.pdf', {
      with: 'Preview',
    });
  });

  it('closes main window by dispatching window:hide', async () => {
    await closeMainWindow();
    expect(postedMessages).toContainEqual({ type: 'asyar:window:hide' });
  });

  it('pops to root navigation', async () => {
    await popToRoot();
    expect(postedMessages).toContainEqual({ type: 'asyar:window:hide' });
  });
});
