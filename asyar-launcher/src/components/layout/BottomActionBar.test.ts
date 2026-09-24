// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

const mockAppRelaunch = vi.fn(async () => {});

vi.mock('../../lib/ipc/commands', () => ({
  appRelaunch: () => mockAppRelaunch(),
}));

vi.mock('../../services/i18n', () => ({
  t: (key: string) => {
    if (key === 'settings.about.restart_now') return 'Restart Now';
    if (key === 'actions.title') return 'Actions';
    if (key === 'common.show_more') return 'Show More';
    return key;
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    filteredActions: [],
  },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    activeView: null,
    activeViewPrimaryActionLabel: null,
  },
}));

vi.mock('../../services/extension/extensionManager.svelte', () => ({
  default: {
    getManifestById: () => null,
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    current: null,
  },
}));

import { appUpdateState } from '../../services/update/appUpdateStore.svelte';
import BottomActionBar from './BottomActionBar.svelte';

describe('BottomActionBar - Update Ready Pill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appUpdateState.phase = 'idle';
    appUpdateState.pendingVersion = null;
  });

  it('does not render update-ready pill when phase is idle', () => {
    render(BottomActionBar, {
      props: {
        isActionListOpen: false,
        onactionListToggled: () => {},
        onactionListClosed: () => {},
      },
    });

    expect(screen.queryByTitle('Restart Now')).toBeNull();
  });

  it('renders update-ready pill with version and restarts on click when phase is ready', async () => {
    appUpdateState.phase = 'ready';
    appUpdateState.pendingVersion = '0.1.2';

    render(BottomActionBar, {
      props: {
        isActionListOpen: false,
        onactionListToggled: () => {},
        onactionListClosed: () => {},
      },
    });

    const pills = screen.getAllByTitle('Restart Now');
    expect(pills.length).toBeGreaterThanOrEqual(1);
    expect(pills[0].textContent).toContain('Update 0.1.2 ready');

    await fireEvent.click(pills[0]);
    expect(mockAppRelaunch).toHaveBeenCalledTimes(1);
  });
});
