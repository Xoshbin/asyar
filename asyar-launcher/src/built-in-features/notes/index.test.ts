/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => vi.fn()),
}));

vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/ipc/commands', () => ({
  noteExportMarkdown: vi.fn().mockResolvedValue('/path/to/note.md'),
  stickyOpen: vi.fn().mockResolvedValue(undefined),
  stickyClose: vi.fn().mockResolvedValue(undefined),
  stickyIsStuck: vi.fn().mockResolvedValue(false),
  stickyNew: vi.fn().mockResolvedValue(undefined),
  noteGetAll: vi.fn().mockResolvedValue([]),
  noteUpsert: vi.fn().mockResolvedValue(undefined),
  noteRemove: vi.fn().mockResolvedValue(undefined),
  noteTogglePin: vi.fn().mockResolvedValue(undefined),
  noteUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    setActionExecutor: vi.fn(),
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: { report: vi.fn() },
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));

vi.mock('./noteStore.svelte', () => ({
  noteStore: {
    init: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    add: vi.fn(),
    remove: vi.fn(),
    togglePin: vi.fn(),
    appendToToday: vi.fn(),
  },
}));

vi.mock('./noteViewState.svelte', () => ({
  noteViewState: {
    createNote: vi.fn().mockResolvedValue(undefined),
    moveSelection: vi.fn(),
    selectAfterMutation: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    setSearch: vi.fn().mockResolvedValue(undefined),
    selectedNote: { id: 'n1', title: 'Test Note', body: 'Body content' },
  },
}));

import { listen } from '@tauri-apps/api/event';
import { actionService } from '../../services/action/actionService.svelte';
import notesExtension from './index';
import { noteStore } from './noteStore.svelte';
import { noteViewState } from './noteViewState.svelte';
import { stickyNew } from '../../lib/ipc/commands';

function makeContext(manager: object) {
  return {
    getService: <T>(_name: string): T => manager as unknown as T,
  };
}

describe('NotesExtension contract & commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('default export is an object with executeCommand', () => {
    expect(typeof notesExtension).toBe('object');
    expect(typeof notesExtension.executeCommand).toBe('function');
  });

  it('initialize wires act_notes_add and initializes noteStore', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await notesExtension.initialize(ctx as never);

    expect(noteStore.init).toHaveBeenCalled();
    expect(actionService.setActionExecutor).toHaveBeenCalledWith(
      'act_notes_add',
      expect.any(Function),
    );

    const [, executor] = vi.mocked(actionService.setActionExecutor).mock.calls[0];
    await executor();
    expect(navigateToView).toHaveBeenCalledWith('notes/DefaultView');
    expect(noteViewState.createNote).toHaveBeenCalled();
  });

  it('executeCommand("open-notes") navigates to notes/DefaultView', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await notesExtension.initialize(ctx as never);

    const result = await notesExtension.executeCommand('open-notes');
    expect(navigateToView).toHaveBeenCalledWith('notes/DefaultView');
    expect(result).toEqual({ type: 'view', viewPath: 'notes/DefaultView' });
  });

  it('executeCommand("quick-note") captures note and returns no-view', async () => {
    const result = await notesExtension.executeCommand('quick-note', {
      arguments: { text: 'my quick thought' },
    });
    expect(noteStore.add).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'my quick thought',
      }),
    );
    expect(result).toEqual({ type: 'no-view' });
  });

  it('executeCommand("new-sticky") calls stickyNew', async () => {
    const result = await notesExtension.executeCommand('new-sticky');
    expect(stickyNew).toHaveBeenCalled();
    expect(result).toEqual({ type: 'no-view' });
  });

  it('executeCommand("append-today") appends to today note', async () => {
    const result = await notesExtension.executeCommand('append-today', {
      arguments: { text: 'daily summary log' },
    });
    expect(noteStore.appendToToday).toHaveBeenCalledWith('daily summary log');
    expect(result).toEqual({ type: 'no-view' });
  });

  it('onViewSearch updates search state', async () => {
    await notesExtension.onViewSearch('shopping');
    expect(noteViewState.setSearch).toHaveBeenCalledWith('shopping');
  });
});

describe('NotesExtension lifecycle: viewActivated, viewDeactivated, activate, deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  it('viewActivated attaches keydown listener, listens for notes:changed, and registers view actions', async () => {
    await notesExtension.viewActivated('notes/DefaultView');

    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(listen).toHaveBeenCalledWith('notes:changed', expect.any(Function), undefined);
    expect(noteStore.reload).toHaveBeenCalled();
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notes:add' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notes:toggle-pin' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notes:delete' }),
    );
  });

  it('viewDeactivated cleans up keydown listener, resets view state, and unregisters actions', async () => {
    const unlistenMock = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlistenMock);

    await notesExtension.viewActivated('notes/DefaultView');
    await notesExtension.viewDeactivated('notes/DefaultView');

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(unlistenMock).toHaveBeenCalled();
    expect(noteViewState.reset).toHaveBeenCalled();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:add');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:toggle-pin');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:duplicate');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:copy-markdown');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:stick-to-desktop');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:export-markdown');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:delete');
  });

  it('activate() reloads noteStore', async () => {
    await notesExtension.activate();
    expect(noteStore.reload).toHaveBeenCalledTimes(1);
  });

  it('deactivate() cleans up listeners, resets state, and unregisters actions', async () => {
    const unlistenMock = vi.fn();
    vi.mocked(listen).mockResolvedValueOnce(unlistenMock);

    await notesExtension.viewActivated('notes/DefaultView');
    await notesExtension.deactivate();

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(unlistenMock).toHaveBeenCalled();
    expect(noteViewState.reset).toHaveBeenCalled();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:add');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:delete');
  });

  it('deactivate() is safe and idempotent when not in view', async () => {
    await notesExtension.deactivate();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('notes:add');
    expect(noteViewState.reset).toHaveBeenCalled();
  });
});

describe('NotesExtension keyboard navigation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await notesExtension.viewActivated('notes/DefaultView');
  });

  afterEach(async () => {
    document.body.innerHTML = '';
    await notesExtension.viewDeactivated('notes/DefaultView');
  });

  function press(target: Element, key: string) {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  }

  it('moves the selection when focus is in the launcher search input', () => {
    const search = document.createElement('input');
    document.body.appendChild(search);

    const down = press(search, 'ArrowDown');
    expect(noteViewState.moveSelection).toHaveBeenCalledWith('down');
    expect(down.defaultPrevented).toBe(true);

    press(search, 'ArrowUp');
    expect(noteViewState.moveSelection).toHaveBeenCalledWith('up');
  });

  it('leaves arrow keys alone inside the note editor fields', () => {
    const editor = document.createElement('div');
    editor.className = 'note-editor';
    const body = document.createElement('textarea');
    editor.appendChild(body);
    document.body.appendChild(editor);

    const e = press(body, 'ArrowDown');
    expect(noteViewState.moveSelection).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('does not navigate while a modal or action popup is open', () => {
    const popup = document.createElement('div');
    popup.className = 'action-popup';
    document.body.appendChild(popup);

    press(document.body, 'ArrowDown');
    expect(noteViewState.moveSelection).not.toHaveBeenCalled();
  });
});
