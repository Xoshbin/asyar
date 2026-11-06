// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const { resolveRemoteIcon } = vi.hoisted(() => ({ resolveRemoteIcon: vi.fn() }));

vi.mock('../../services/icon/remoteIconService', () => ({ resolveRemoteIcon }));

import AppIcon from './AppIcon.svelte';

describe('AppIcon remote icons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveRemoteIcon.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never points an img at the extension URL and swaps in the local icon', async () => {
    resolveRemoteIcon.mockResolvedValue('asyar-icon://localhost/remote-a.png');

    const { container } = render(AppIcon, {
      icon: 'https://example.com/x.png',
      extensionId: 'org.x',
      alt: 'X',
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.app-icon-placeholder')).toBeTruthy();
    expect(resolveRemoteIcon).toHaveBeenCalledWith('org.x', 'https://example.com/x.png');

    await vi.waitFor(() => {
      const image = container.querySelector('img');
      expect(image?.getAttribute('src')).toBe('asyar-icon://localhost/remote-a.png');
    });
    expect(container.querySelector('img')?.getAttribute('src')).not.toContain('https://');
  });

  it('keeps the fallback when the host cannot resolve the icon', async () => {
    resolveRemoteIcon.mockResolvedValue(null);

    const { container } = render(AppIcon, {
      icon: 'https://example.com/x.png',
      extensionId: 'org.x',
    });

    await vi.waitFor(() => expect(resolveRemoteIcon).toHaveBeenCalled());
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.app-icon-placeholder')).toBeTruthy();
  });

  it('does not render a remote icon without an owning extension', async () => {
    const { container } = render(AppIcon, { icon: 'https://example.com/x.png' });

    await vi.waitFor(() =>
      expect(resolveRemoteIcon).toHaveBeenCalledWith(undefined, 'https://example.com/x.png'),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.app-icon-placeholder')).toBeTruthy();
  });

  it('still renders local image icons synchronously', () => {
    const { container } = render(AppIcon, {
      icon: 'asyar-extension://org.x/icon.png',
      alt: 'X',
    });

    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'asyar-extension://org.x/icon.png',
    );
    expect(resolveRemoteIcon).not.toHaveBeenCalled();
  });
});
