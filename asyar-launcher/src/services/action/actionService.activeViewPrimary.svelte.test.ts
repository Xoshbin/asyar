import { describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import { ActionContext } from 'asyar-sdk/contracts';
import { ActionService, type ApplicationAction } from './actionService.svelte';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ActionService.activeViewPrimaryAction reactivity', () => {
  it('updates reactively across CORE -> EXTENSION_VIEW transitions and action registrations', () => {
    const svc = new ActionService();
    const observed: Array<string | null> = [];

    const cleanup = $effect.root(() => {
      $effect(() => {
        observed.push(svc.activeViewPrimaryAction?.label ?? null);
      });

      flushSync();
      expect(observed).toEqual([null]);

      // Register view actions BEFORE switching context (mirrors ViewExtension.viewActivated)
      let empty = true;
      svc.registerAction({
        id: 'snippets:create-empty',
        label: 'Add your first snippet',
        shortcut: 'Enter',
        primary: true,
        extensionId: 'snippets',
        context: ActionContext.EXTENSION_VIEW,
        visible: () => empty,
        execute: () => {},
      } satisfies ApplicationAction);
      flushSync();

      svc.setContext(ActionContext.EXTENSION_VIEW, 'snippets');
      flushSync();
      expect(observed[observed.length - 1]).toBe('Add your first snippet');

      // Sub-form opens and overrides with Mod+Enter primary action
      empty = false;
      svc.registerAction({
        id: 'snippets:save',
        label: 'Create Snippet',
        shortcut: 'Mod+Enter',
        primary: true,
        extensionId: 'snippets',
        context: ActionContext.EXTENSION_VIEW,
        execute: () => {},
      } satisfies ApplicationAction);
      svc.refreshFiltered();
      flushSync();
      expect(observed[observed.length - 1]).toBe('Create Snippet');

      // Sub-form closes -> falls back to empty-state Enter action
      empty = true;
      svc.unregisterAction('snippets:save');
      svc.refreshFiltered();
      flushSync();
      expect(observed[observed.length - 1]).toBe('Add your first snippet');

      // Leaving extension view restores null
      svc.setContext(ActionContext.CORE);
      flushSync();
      expect(observed[observed.length - 1]).toBeNull();
    });

    cleanup();
  });
});
