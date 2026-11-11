/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
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

describe('SnippetFormView', () => {
  beforeEach(() => {
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
});
