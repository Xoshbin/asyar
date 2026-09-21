// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

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

import FeaturedExtensions from './FeaturedExtensions.svelte';

describe('FeaturedExtensions step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
