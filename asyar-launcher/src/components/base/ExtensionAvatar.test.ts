// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

const { resolveRemoteIcon } = vi.hoisted(() => ({ resolveRemoteIcon: vi.fn() }));
vi.mock('../../services/icon/remoteIconService', () => ({ resolveRemoteIcon }));
vi.mock('../../lib/keyboard/hostPlatform', () => ({ getHostPlatform: () => 'linux' }));

import ExtensionAvatar from './ExtensionAvatar.svelte';

describe('ExtensionAvatar', () => {
  it('renders initials when no icon is provided', () => {
    const { container } = render(ExtensionAvatar, { name: 'Zed' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent?.trim()).toBe('Z');
  });

  it('resolves remote icon through AppIcon when icon is an https URL', async () => {
    resolveRemoteIcon.mockResolvedValue('asyar-icon://localhost/remote-zed.png');
    const { container } = render(ExtensionAvatar, {
      name: 'Zed',
      icon: 'https://assets.asyar.org/6/icon.png',
    });

    await vi.waitFor(() => {
      const img = container.querySelector('img');
      expect(img).not.toBeNull();
      expect(img?.getAttribute('src')).toBe('asyar-icon://localhost/remote-zed.png');
    });
    expect(resolveRemoteIcon).toHaveBeenCalledWith('store', 'https://assets.asyar.org/6/icon.png');
  });

  it('falls back to initials when remote icon resolution fails', async () => {
    resolveRemoteIcon.mockResolvedValueOnce('asyar-icon://localhost/old.png');
    const { container, rerender } = render(ExtensionAvatar, {
      name: 'Zed',
      icon: 'https://assets.asyar.org/6/icon.png',
    });
    await vi.waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    await fireEvent.error(container.querySelector('img')!);
    expect(container.textContent?.trim()).toBe('Z');

    let finish!: (result: null) => void;
    resolveRemoteIcon.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
    );
    await rerender({ name: 'Zed', icon: 'https://assets.asyar.org/7/icon.png' });
    await vi.waitFor(() => expect(container.querySelector('.app-icon-placeholder')).not.toBeNull());
    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('img')).toBeNull();

    finish(null);
    await vi.waitFor(() => expect(container.textContent?.trim()).toBe('Z'));
    expect(container.querySelector('.app-icon-placeholder')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders emoji icon when provided', () => {
    const { container } = render(ExtensionAvatar, {
      name: 'Coffee',
      icon: '☕',
    });
    expect(container.textContent?.trim()).toContain('☕');
  });
});
