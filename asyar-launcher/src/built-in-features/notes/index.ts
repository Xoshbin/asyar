import type {
  CommandExecuteArgs,
  Extension,
  ExtensionContext,
  IExtensionManager,
} from 'asyar-sdk/contracts';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import { noteStore, type Note } from './noteStore.svelte';
import { noteViewState } from './noteViewState.svelte';
import { splitQuickCapture } from './quickCapture';
import { ActionContext } from 'asyar-sdk/contracts';
import { actionService } from '../../services/action/actionService.svelte';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { writeText } from 'tauri-plugin-clipboard-x-api';

function noteAsMarkdown(title: string, body: string): string {
  return title.trim() ? `# ${title}\n\n${body}` : body;
}

function toastSaved(message: string): void {
  feedbackService.report({
    source: 'frontend',
    kind: 'manual',
    severity: 'success',
    retryable: false,
    context: { message },
  });
}

function quickCaptureNote(text: string): Note {
  const now = Date.now();
  const note: Note = {
    id: crypto.randomUUID(),
    ...splitQuickCapture(text),
    createdAt: now,
    updatedAt: now,
    pinned: false,
  };
  noteStore.add(note);
  return note;
}

class NotesExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
    await noteStore.init();

    // Root "New Note" action — available from root search before the view
    // opens, same handshake shape as snippets' act_snippets_add.
    actionService.setActionExecutor('act_notes_add', async () => {
      this.extensionManager?.navigateToView('notes/DefaultView');
      await noteViewState.createNote();
    });
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.inView) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      void noteViewState.createNote();
      return;
    }

    const target = e.target as HTMLElement | null;
    const inEditableField =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (inEditableField) return; // let the field handle its own keys (typing, cursor movement)

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      noteViewState.moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
    }
  }

  async executeCommand(commandId: string, args?: CommandExecuteArgs): Promise<any> {
    if (commandId === 'open-notes') {
      this.extensionManager?.navigateToView('notes/DefaultView');
      return { type: 'view', viewPath: 'notes/DefaultView' };
    }

    if (commandId === 'quick-note') {
      const text = String(args?.arguments?.text ?? '').trim();
      if (text) {
        quickCaptureNote(text);
        toastSaved('Note saved');
      }
      return { type: 'no-view' };
    }

    if (commandId === 'append-today') {
      const text = String(args?.arguments?.text ?? '').trim();
      if (text) {
        noteStore.appendToToday(text);
        toastSaved('Added to today');
      }
      return { type: 'no-view' };
    }
  }

  async viewActivated(_viewId: string): Promise<void> {
    this.inView = true;
    window.addEventListener('keydown', this.handleKeydownBound);
    await noteStore.reload();

    actionService.registerAction({
      id: 'notes:add',
      label: 'New Note',
      icon: 'icon:plus',
      description: 'Create a new note',
      category: 'Notes',
      extensionId: 'notes',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await noteViewState.createNote();
      },
    });
    actionService.registerAction({
      id: 'notes:toggle-pin',
      label: 'Pin/Unpin Note',
      icon: 'icon:pin',
      description: 'Pin or unpin the selected note to keep it at the top',
      category: 'Notes',
      extensionId: 'notes',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const n = noteViewState.selectedNote;
        if (n) noteStore.togglePin(n.id);
      },
    });
    actionService.registerAction({
      id: 'notes:duplicate',
      label: 'Duplicate Note',
      icon: 'icon:layers',
      description: 'Create a duplicate of the selected note',
      category: 'Notes',
      extensionId: 'notes',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const n = noteViewState.selectedNote;
        if (!n) return;
        const now = Date.now();
        const dup = {
          id: crypto.randomUUID(),
          title: n.title ? `${n.title} Copy` : '',
          body: n.body,
          createdAt: now,
          updatedAt: now,
          pinned: false,
        };
        noteStore.add(dup);
        await noteViewState.selectAfterMutation(dup.id);
      },
    });
    actionService.registerAction({
      id: 'notes:copy-markdown',
      label: 'Copy as Markdown',
      icon: 'icon:copy',
      description: 'Copy the selected note to the clipboard as Markdown',
      category: 'Notes',
      extensionId: 'notes',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const n = noteViewState.selectedNote;
        if (n) await writeText(noteAsMarkdown(n.title, n.body));
      },
    });
    actionService.registerAction({
      id: 'notes:delete',
      label: 'Delete Note',
      icon: 'icon:trash',
      description: 'Delete the selected note',
      category: 'Notes',
      extensionId: 'notes',
      context: ActionContext.EXTENSION_VIEW,
      confirm: true,
      destructive: true,
      execute: async () => {
        const n = noteViewState.selectedNote;
        if (n) noteStore.remove(n.id);
      },
    });
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    noteViewState.reset();
    actionService.unregisterAction('notes:add');
    actionService.unregisterAction('notes:toggle-pin');
    actionService.unregisterAction('notes:duplicate');
    actionService.unregisterAction('notes:copy-markdown');
    actionService.unregisterAction('notes:delete');
  }

  async onViewSearch(query: string): Promise<void> {
    await noteViewState.setSearch(query);
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new NotesExtension();
export { DefaultView };
