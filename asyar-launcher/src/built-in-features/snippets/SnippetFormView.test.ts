/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SnippetFormView from './SnippetFormView.svelte';
import { snippetStore } from './snippetStore.svelte';
import { snippetViewState } from './snippetViewState.svelte';
import { snippetUiState } from './snippetUiState.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./snippetService', () => ({
  snippetService: {
    onViewOpen: vi.fn().mockResolvedValue({ permissionGranted: true }),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    syncToRust: vi.fn().mockResolvedValue(true),
  },
  enabledPersistence: { loadSync: vi.fn(() => true) },
  processSnippetExpansion: vi.fn(async (expansion: string) => ({
    expansion,
    redactedKinds: [],
  })),
}));

import { processSnippetExpansion, snippetService } from './snippetService';

describe('SnippetFormView', () => {
  beforeEach(() => {
    viewManager.activeView = 'snippets/SnippetFormView';
    snippetStore.snippets = [];
    snippetViewState.reset();
    snippetUiState.prefillExpansion = null;
  });

  afterEach(() => {
    snippetViewState.cancelEdit();
    snippetUiState.prefillExpansion = null;
    vi.restoreAllMocks();
  });

  it('registers Mod+Enter primary action without inline Save/Cancel buttons in create mode', () => {
    snippetViewState.startCreate();
    render(SnippetFormView);

    expect(screen.getByText('New Snippet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();

    const saveAction = actionService.getAllActions().find((a) => a.id === 'snippets:save');
    expect(saveAction?.shortcut).toBe('Mod+Enter');
    expect(saveAction?.primary).toBe(true);
  });

  it('prefills fields in edit mode and pops back via viewManager.goBack on save', async () => {
    const existing = {
      id: 's1',
      name: 'Work Email',
      keyword: ';email',
      expansion: 'work@example.com',
      createdAt: 100,
      isPrivate: true,
    };
    snippetStore.snippets = [existing];
    snippetViewState.startEdit(existing);
    const goBackSpy = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});

    render(SnippetFormView);
    expect(screen.getByText('Edit Snippet')).toBeTruthy();
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Work Email');

    const saveAction = actionService.getAllActions().find((a) => a.id === 'snippets:save');
    await saveAction?.execute();

    expect(goBackSpy).toHaveBeenCalledTimes(1);
    expect(snippetViewState.mode).toBe('view');
  });

  it('consumes clipboard prefillExpansion when mounted in create mode', () => {
    snippetUiState.prefillExpansion = 'copied snippet body';
    snippetViewState.startCreate();

    render(SnippetFormView);

    expect((screen.getByLabelText(/expansion/i) as HTMLTextAreaElement).value).toBe(
      'copied snippet body',
    );
    expect(snippetUiState.prefillExpansion).toBeNull();
  });
  it.each(['cancel', 'unmount', 'concurrent'])('guards a pending save: %s', async (mode) => {
    snippetViewState.startCreate();
    const goBack = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});
    const { unmount } = render(SnippetFormView);
    await fireEvent.input(screen.getByLabelText(/name/i), { target: { value: 'Test' } });
    await fireEvent.input(screen.getByLabelText(/expansion/i), { target: { value: 'body' } });
    let resolve!: (value: { expansion: string; redactedKinds: never[] }) => void;
    const process = vi
      .mocked(processSnippetExpansion)
      .mockReturnValueOnce(new Promise((r) => (resolve = r)));
    process.mockClear();
    const save = actionService.getAllActions().find((a) => a.id === 'snippets:save')!;
    const pending = save.execute();
    if (mode === 'cancel') viewManager.tryInterceptEscape();
    if (mode === 'unmount') unmount();
    if (mode === 'concurrent') await save.execute();
    resolve({ expansion: 'body', redactedKinds: [] });
    await pending;
    expect(process).toHaveBeenCalledTimes(1);
    expect(snippetStore.getAll()).toHaveLength(mode === 'concurrent' ? 1 : 0);
    expect(goBack).toHaveBeenCalledTimes(mode === 'unmount' ? 0 : 1);
  });

  it.each([
    [false, true],
    [true, false],
    [true, true],
  ])('initializes expansion with enabled=%s and permission=%s', async (preference, permission) => {
    const { enabledPersistence } = await import('./snippetService');
    vi.mocked(enabledPersistence.loadSync).mockReturnValueOnce(preference);
    vi.mocked(snippetService.onViewOpen).mockResolvedValueOnce({ permissionGranted: permission });
    const enabled = vi.mocked(snippetService.setEnabled).mockClear();
    render(SnippetFormView);
    await vi.waitFor(() => expect(enabled).toHaveBeenCalledWith(preference && permission));
  });
  it('allows retry after processing fails', async () => {
    snippetViewState.startCreate();
    vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});
    render(SnippetFormView);
    await fireEvent.input(screen.getByLabelText(/name/i), { target: { value: 'Test' } });
    await fireEvent.input(screen.getByLabelText(/expansion/i), { target: { value: 'body' } });
    vi.mocked(processSnippetExpansion).mockRejectedValueOnce(new Error('failed'));
    const save = actionService.getAllActions().find((a) => a.id === 'snippets:save')!;
    await expect(save.execute()).rejects.toThrow('failed');
    await save.execute();
    expect(snippetStore.getAll()).toHaveLength(1);
  });
});
