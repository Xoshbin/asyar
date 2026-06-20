// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

vi.mock('../../../services/browser/browserService', () => ({
  browserService: {
    listAvailableBrowsers: vi.fn(async () => []),
    listPairedBrowsers: vi.fn(async () => []),
    isCompanionInstalled: vi.fn(async () => false),
  },
}));

vi.mock('../../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn() },
}));

import BrowsersTab from './BrowsersTab.svelte';

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockClear();
});

describe('Settings → Browsers tab', () => {
  it('shows empty state when no browsers paired', async () => {
    invokeMock.mockResolvedValue([]);
    render(BrowsersTab);
    await screen.findByText(/No browsers paired/i);
  });

  it('opens the Chrome Web Store companion listing when "Install for Chrome" is clicked', async () => {
    invokeMock.mockResolvedValue([]);
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    render(BrowsersTab);
    const btn = await screen.findByTestId('install-chromium');
    await fireEvent.click(btn);
    expect(openUrl).toHaveBeenCalledWith(
      'https://chromewebstore.google.com/detail/clgmndlecfeilanhmiohfjmgfgilpjic',
    );
  });

  it('renders pending pairing requests and resolves on Allow', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'browser_list_pending_pairings') {
        return Promise.resolve([{ id: 'p1', family: 'chromium', variant: 'chrome' }]);
      }
      return Promise.resolve(undefined);
    });
    render(BrowsersTab);
    const allowBtn = await screen.findByTestId('allow-p1');
    await fireEvent.click(allowBtn);
    expect(invokeMock).toHaveBeenCalledWith('browser_resolve_pairing', {
      pairingId: 'p1',
      decision: 'allow',
    });
  });
});
