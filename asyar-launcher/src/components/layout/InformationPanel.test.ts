// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import InformationPanel from './InformationPanel.svelte';
import type { ExtendedManifest } from '../../types/ExtendedManifest';

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    activeViewSubtitle: 'Pomodoro Timer',
  },
}));

vi.mock('../../lib/keyboard/hostPlatform', () => ({
  getHostPlatform: () => 'linux',
}));

describe('InformationPanel', () => {
  it('renders nothing when activeViewManifest is null', () => {
    const { container } = render(InformationPanel, {
      activeViewManifest: null,
    });
    expect(container.querySelector('.info-chip')).toBeNull();
  });

  it('renders clean icon and labels without a blue square badge background', () => {
    const manifest: ExtendedManifest = {
      id: 'org.asyar.pomodoro',
      name: 'Pomodoro',
      description: 'Pomodoro timer extension',
      version: '1.0.0',
      commands: [],
      resolvedIcon: {
        kind: 'image',
        src: 'asyar-extension://org.asyar.pomodoro/assets/icon.png',
      },
    };

    const { container } = render(InformationPanel, {
      activeViewManifest: manifest,
    });

    const chip = container.querySelector('.info-chip');
    expect(chip).not.toBeNull();

    // Verify the old blue badge wrapper is gone and replaced by the clean icon container
    expect(container.querySelector('.info-chip-badge')).toBeNull();
    const iconWrapper = container.querySelector('.info-chip-icon');
    expect(iconWrapper).not.toBeNull();

    // Verify AppIcon rendered within
    const img = iconWrapper?.querySelector('img.app-icon');
    expect(img?.getAttribute('src')).toBe('asyar-extension://org.asyar.pomodoro/assets/icon.png');

    // Verify labels
    expect(screen.getByText('Pomodoro')).not.toBeNull();
    expect(screen.getByText('Pomodoro Timer')).not.toBeNull();
  });
});
