// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const fetchTopExtensions = vi.hoisted(() => vi.fn());
const advanceStep = vi.hoisted(() => vi.fn());
const goBackStep = vi.hoisted(() => vi.fn());
const completeStep = vi.hoisted(() => vi.fn());
const installExtension = vi.hoisted(() => vi.fn());
const listInstalledExtensions = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock('../stepLogic', () => ({
  fetchTopExtensions,
  advanceStep,
  goBackStep,
  completeStep,
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => 'macos'),
}));

vi.mock('../../../built-in-features/store/index.svelte', () => ({
  default: { installExtension },
}));

vi.mock('../../../lib/ipc/commands', () => ({ listInstalledExtensions }));

import FeaturedExtensions from './FeaturedExtensions.svelte';
import { onboardingNav } from '../onboardingNav.svelte';

describe('FeaturedExtensions step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listInstalledExtensions.mockResolvedValue([]);
  });

  it('hides Emoji when it was installed in the earlier onboarding step', async () => {
    listInstalledExtensions.mockResolvedValueOnce(['org.asyar.emoji']);
    fetchTopExtensions.mockResolvedValueOnce([
      { id: 100, name: 'Emoji', slug: 'emoji' },
      { id: 101, name: 'GitHub Assistant', slug: 'github-assistant' },
    ]);

    render(FeaturedExtensions);

    expect(await screen.findByText('GitHub Assistant')).toBeTruthy();
    expect(screen.queryByText('Emoji')).toBeNull();
  });

  it('renders extension list and mentions creating custom extensions with AI when store feels empty', async () => {
    fetchTopExtensions.mockResolvedValueOnce([
      {
        id: 101,
        name: 'GitHub Assistant',
        slug: 'github-assistant',
      },
      {
        id: 102,
        name: 'Color Picker',
        slug: 'color-picker',
      },
    ]);

    render(FeaturedExtensions);

    expect(await screen.findByText('GitHub Assistant')).toBeTruthy();
    expect(screen.getByText('Color Picker')).toBeTruthy();

    // Verify the store-empty tip is displayed
    expect(
      screen.getByText((content) => content.includes("Store feels empty? Don't be disappointed!")),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (content) =>
          content.includes('Create Extension with AI') &&
          content.includes('forget to push them to the store'),
      ),
    ).toBeTruthy();
  });

  it('marks installed extensions and prevents selecting them again', async () => {
    listInstalledExtensions.mockResolvedValueOnce(['org.example.github']);
    fetchTopExtensions.mockResolvedValueOnce([
      {
        id: 101,
        name: 'GitHub Assistant',
        slug: 'github-assistant',
        manifest: { id: 'org.example.github' },
      },
    ]);

    render(FeaturedExtensions);

    expect(await screen.findByText('Installed')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /GitHub Assistant/ }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('refreshes installed status after installing a selected extension', async () => {
    listInstalledExtensions.mockResolvedValueOnce([]).mockResolvedValueOnce(['org.example.github']);
    fetchTopExtensions.mockResolvedValueOnce([
      {
        id: 101,
        name: 'GitHub Assistant',
        slug: 'github-assistant',
        manifest: { id: 'org.example.github' },
      },
    ]);

    render(FeaturedExtensions);
    const checkbox = await screen.findByRole('checkbox', { name: /GitHub Assistant/ });
    await fireEvent.click(checkbox);
    await onboardingNav.current.onPrimary();

    expect(await screen.findByText('Installed')).toBeTruthy();
    expect(listInstalledExtensions).toHaveBeenCalledTimes(2);
  });

  it('detects installed status from full filesystem directory paths', async () => {
    listInstalledExtensions.mockResolvedValueOnce([
      '/Users/test/Library/Application Support/org.asyar.app/extensions/org.example.github',
    ]);
    fetchTopExtensions.mockResolvedValueOnce([
      {
        id: 101,
        name: 'GitHub Assistant',
        slug: 'github-assistant',
        manifest: { id: 'org.example.github' },
      },
    ]);

    render(FeaturedExtensions);

    expect(await screen.findByText('Installed')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /GitHub Assistant/ }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('updates installed status in real time when extensions_updated event fires', async () => {
    let onExtensionsUpdated: (() => void) | undefined;
    listenMock.mockImplementation((event: string, handler: any) => {
      if (event === 'extensions_updated') {
        onExtensionsUpdated = handler;
      }
      return Promise.resolve(() => {});
    });

    listInstalledExtensions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        '/Users/test/Library/Application Support/org.asyar.app/extensions/org.example.github',
      ]);
    fetchTopExtensions.mockResolvedValueOnce([
      {
        id: 101,
        name: 'GitHub Assistant',
        slug: 'github-assistant',
        manifest: { id: 'org.example.github' },
      },
    ]);

    render(FeaturedExtensions);
    expect(await screen.findByText('GitHub Assistant')).toBeTruthy();
    expect(screen.queryByText('Installed')).toBeNull();

    // Simulate backend emitting extensions_updated
    onExtensionsUpdated?.();

    expect(await screen.findByText('Installed')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: /GitHub Assistant/ }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it('updates installed status in real time when window event fires', async () => {
    listInstalledExtensions.mockResolvedValueOnce([]).mockResolvedValueOnce(['org.example.github']);
    fetchTopExtensions.mockResolvedValueOnce([
      {
        id: 101,
        name: 'GitHub Assistant',
        slug: 'github-assistant',
        manifest: { id: 'org.example.github' },
      },
    ]);

    render(FeaturedExtensions);
    expect(await screen.findByText('GitHub Assistant')).toBeTruthy();
    expect(screen.queryByText('Installed')).toBeNull();

    window.dispatchEvent(
      new CustomEvent('store-extension-installed', { detail: { id: 'org.example.github' } }),
    );

    expect(await screen.findByText('Installed')).toBeTruthy();
  });

  it('renders empty state and AI creation tip when no extensions are returned', async () => {
    fetchTopExtensions.mockResolvedValueOnce([]);

    render(FeaturedExtensions);

    expect(await screen.findByText("Couldn't reach the extension store.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // The tip is still visible to reassure users
    expect(
      screen.getByText((content) => content.includes("Store feels empty? Don't be disappointed!")),
    ).toBeTruthy();
    expect(
      screen.getByText(
        (content) =>
          content.includes('Create Extension with AI') &&
          content.includes('forget to push them to the store'),
      ),
    ).toBeTruthy();
  });
});
