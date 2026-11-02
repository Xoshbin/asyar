// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  transformCallback: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/sync/syncEncryptionService.svelte', () => ({
  syncEncryptionService: {
    mode: 'device-key',
    showRecoveryPhrase: vi.fn(),
    showRecoveryPhraseDevice: vi.fn(),
  },
}));

import RecoveryPhraseDialog from './RecoveryPhraseDialog.svelte';
import { syncEncryptionService } from '../../services/sync/syncEncryptionService.svelte';

describe('RecoveryPhraseDialog (device-key)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement <dialog> modal methods.
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
  });

  it('does not retry the phrase fetch in a loop after it fails', async () => {
    vi.mocked(syncEncryptionService.showRecoveryPhraseDevice).mockRejectedValue(
      new Error('keychain unavailable'),
    );

    render(RecoveryPhraseDialog, { isOpen: true });

    await waitFor(() =>
      expect(syncEncryptionService.showRecoveryPhraseDevice).toHaveBeenCalledTimes(1),
    );
    // Give the effect a few macrotasks to (wrongly) fire again.
    await new Promise((r) => setTimeout(r, 50));
    expect(syncEncryptionService.showRecoveryPhraseDevice).toHaveBeenCalledTimes(1);
  });
});
