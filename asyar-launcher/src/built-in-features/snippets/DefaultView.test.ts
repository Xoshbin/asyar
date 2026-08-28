// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { load, loadSync, onViewOpen, save, setEnabled } = vi.hoisted(() => ({
  load: vi.fn(),
  loadSync: vi.fn(),
  onViewOpen: vi.fn(),
  save: vi.fn(),
  setEnabled: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../components', async () => {
  const Stub = (await import('./DefaultViewTestStub.svelte')).default;
  return {
    ActionFooter: Stub,
    Badge: Stub,
    Button: Stub,
    EmptyState: Stub,
    FormField: Stub,
    Input: Stub,
    LauncherListRow: Stub,
    PlaceholderPicker: Stub,
    SplitListDetail: Stub,
    Textarea: Stub,
    WarningBanner: Stub,
  };
});

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { confirmAlert: vi.fn() },
}));

vi.mock('../../services/i18n', () => ({ t: (key: string) => key }));

vi.mock('./snippetService', async (importActual) => ({
  ...(await importActual<typeof import('./snippetService')>()),
  enabledPersistence: { load, loadSync, save },
  snippetService: {
    onViewOpen,
    setEnabled,
    syncToRust: vi.fn(),
    openAccessibilityPreferences: vi.fn(),
  },
}));

import DefaultView from './DefaultView.svelte';

describe('DefaultView snippet runtime synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSync.mockReturnValue(true);
  });

  it('uses durable false when localStorage has no synchronous value', async () => {
    load.mockResolvedValue(false);
    onViewOpen.mockResolvedValue({ permissionGranted: true });

    render(DefaultView);

    await vi.waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false));
    expect(save).not.toHaveBeenCalled();
  });

  it('does not turn a durable true preference off when permission is denied', async () => {
    load.mockResolvedValue(true);
    onViewOpen.mockResolvedValue({ permissionGranted: false });

    render(DefaultView);

    await vi.waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false));
    expect(load).toHaveBeenCalledWith(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('reenables runtime when permission becomes granted without changing preference', async () => {
    load.mockResolvedValue(true);
    onViewOpen
      .mockResolvedValueOnce({ permissionGranted: false })
      .mockResolvedValueOnce({ permissionGranted: true });

    render(DefaultView);
    await vi.waitFor(() => expect(setEnabled).toHaveBeenCalledWith(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Re-check Permission' }));

    await vi.waitFor(() => expect(setEnabled).toHaveBeenLastCalledWith(true));
    expect(load).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
