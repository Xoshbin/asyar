// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

const listInstalledExtensions = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock('../../lib/ipc/commands', () => ({
  listInstalledExtensions,
  showSettingsWindow: vi.fn(),
}));

vi.mock('../../services/envService', () => ({
  envService: {
    storeApiBaseUrl: 'https://asyar.org',
    supportedSdkVersion: '4.13.0',
    isDev: false,
  },
  SUPPORTED_SDK_VERSION: '4.13.0',
}));

vi.mock('./index.svelte', () => ({
  default: {
    installExtension: vi.fn(),
    uninstallExtension: vi.fn(),
    updateExtension: vi.fn(),
    notifyInstalledStateChanged: vi.fn(),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    report: vi.fn(),
    confirmAlert: vi.fn(),
  },
}));

import DetailView from './DetailView.svelte';
import { storeViewState as store } from './state.svelte';

function mockExtensionResponse(extensionData: Record<string, unknown>) {
  const fullData = {
    id: 'org.asyar.test',
    name: 'Test Extension',
    slug: 'test-ext',
    description: 'A test extension description',
    category: 'Productivity',
    status: 'PUBLISHED',
    repoUrl: 'https://github.com/test/test-ext',
    installCount: 42,
    iconUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    author: {
      id: 1,
      name: 'Test Author',
      githubUsername: 'testauthor',
      avatarUrl: null,
      isVerifiedPublisher: false,
    },
    version: '1.0.0',
    manifest: {
      commands: [{ id: 'cmd1', name: 'Command 1', mode: 'view' }],
    },
    ...extensionData,
  };

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: fullData }),
  } as Response);
}

describe('DetailView SDK Version Compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInstalledExtensions.mockResolvedValue([]);
    store.setSelectedExtensionSlug('test-ext');
  });

  it('renders warning banner and disables install button when asyarSdk is incompatible', async () => {
    mockExtensionResponse({ asyarSdk: '^5.0.0' });

    render(DetailView);

    await waitFor(() => {
      expect(
        screen.getByText('This extension requires a newer version of Asyar (SDK ^5.0.0)'),
      ).toBeTruthy();
    });

    const installBtn = screen.getByRole('button', {
      name: /Incompatible \(Requires SDK \^5\.0\.0\)/i,
    });
    expect(installBtn).toBeTruthy();
    expect((installBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('does NOT render warning banner and enables install button when asyarSdk is compatible', async () => {
    mockExtensionResponse({ asyarSdk: '^4.10.0' });

    render(DetailView);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Install Extension$/i })).toBeTruthy();
    });

    expect(screen.queryByText(/This extension requires a newer version of Asyar/)).toBeNull();

    const installBtn = screen.getByRole('button', { name: /^Install Extension$/i });
    expect((installBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('does NOT render warning banner and enables install button when asyarSdk is omitted', async () => {
    mockExtensionResponse({ asyarSdk: undefined });

    render(DetailView);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Install Extension$/i })).toBeTruthy();
    });

    expect(screen.queryByText(/This extension requires a newer version of Asyar/)).toBeNull();

    const installBtn = screen.getByRole('button', { name: /^Install Extension$/i });
    expect((installBtn as HTMLButtonElement).disabled).toBe(false);
  });
});
