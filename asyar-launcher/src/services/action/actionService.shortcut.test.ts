import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionService } from './actionService.svelte';
import { ActionContext } from 'asyar-sdk/contracts';

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../search/SearchService', () => ({ searchService: { resetIndex: vi.fn() } }));
vi.mock('tauri-plugin-clipboard-x-api', () => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../search/searchOrchestrator.svelte', () => ({ searchOrchestrator: { items: [] } }));
vi.mock('../search/stores/search.svelte', () => ({
  searchStores: { selectedIndex: -1, query: '' },
}));
vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { showHUD: vi.fn(), confirmAlert: vi.fn() },
}));
vi.mock('../application/applicationService', () => ({
  applicationService: { uninstallApplication: vi.fn() },
}));
vi.mock('../extension/commandService.svelte', () => ({ commandService: {} }));

const base = (over: Record<string, unknown>) => ({
  id: 'a',
  label: 'A',
  context: ActionContext.EXTENSION_VIEW,
  extensionId: 'notes',
  execute: () => {},
  ...over,
});

describe('ActionService shortcut registration', () => {
  let svc: ActionService;
  beforeEach(() => {
    svc = new ActionService();
  });

  it('stores a canonical shortcut on the action', () => {
    svc.registerAction(base({ id: 'notes:add', shortcut: 'Mod+N' }) as any);
    expect(svc.getAllActions().find((a) => a.id === 'notes:add')?.shortcut).toBe('Mod+N');
  });

  it.each(['⌘N', 'Super+N', 'Ctrl+N', 'N', 'Enter', 'Mod+K', 'Mod+C', 'Mod+Backspace'])(
    'rejects %s and does not register the action',
    (shortcut) => {
      expect(() => svc.registerAction(base({ id: 'x', shortcut }) as any)).toThrow(/shortcut/i);
      expect(svc.getAllActions().find((a) => a.id === 'x')).toBeUndefined();
    },
  );

  it('refuses a direct shortcut on a destructive action', () => {
    expect(() =>
      svc.registerAction(base({ id: 'd', shortcut: 'Mod+Shift+D', destructive: true }) as any),
    ).toThrow(/destructive/i);
    // Destructive actions without a shortcut stay available in the ⌘K panel.
    expect(() => svc.registerAction(base({ id: 'd', destructive: true }) as any)).not.toThrow();
  });

  it('rejects two always-visible actions that share a chord in one scope', () => {
    svc.registerAction(base({ id: 'one', shortcut: 'Mod+N' }) as any);
    expect(() => svc.registerAction(base({ id: 'two', shortcut: 'Mod+N' }) as any)).toThrow(/one/);
  });

  it('allows re-registering the same action id with the same chord', () => {
    svc.registerAction(base({ id: 'one', shortcut: 'Mod+N' }) as any);
    expect(() => svc.registerAction(base({ id: 'one', shortcut: 'Mod+N' }) as any)).not.toThrow();
  });

  it('allows the same chord in different scopes', () => {
    svc.registerAction(base({ id: 'one', shortcut: 'Mod+N', extensionId: 'notes' }) as any);
    expect(() =>
      svc.registerAction(base({ id: 'two', shortcut: 'Mod+N', extensionId: 'snippets' }) as any),
    ).not.toThrow();
  });

  it('allows the same chord when visibility gates keep the actions apart', () => {
    svc.registerAction(
      base({
        id: 'one',
        shortcut: 'Mod+N',
        context: ActionContext.CORE,
        visible: () => true,
      }) as any,
    );
    expect(() =>
      svc.registerAction(
        base({
          id: 'two',
          shortcut: 'Mod+N',
          context: ActionContext.CORE,
          visible: () => false,
        }) as any,
      ),
    ).not.toThrow();
  });

  it('registers every built-in core action with a valid canonical shortcut', () => {
    const shortcuts = svc
      .getAllActions()
      .filter((a) => a.shortcut)
      .map((a) => a.shortcut);
    expect(shortcuts).toContain('Mod+Shift+C');
    expect(shortcuts).toContain('Mod+Shift+E');
    expect(shortcuts).toContain('Mod+Shift+,');
  });
});

describe('ActionService.getShortcutCandidates', () => {
  let svc: ActionService;
  beforeEach(() => {
    svc = new ActionService();
  });

  it('returns only the visible actions of the current context that declare a shortcut', () => {
    svc.registerAction(base({ id: 'v1', shortcut: 'Mod+N' }) as any);
    svc.registerAction(base({ id: 'v2' }) as any);
    svc.registerAction(base({ id: 'other', shortcut: 'Mod+M', extensionId: 'snippets' }) as any);
    svc.registerAction(base({ id: 'hidden', shortcut: 'Mod+H', visible: () => false }) as any);
    svc.setContext(ActionContext.EXTENSION_VIEW, 'notes');
    expect(svc.getShortcutCandidates().map((a) => a.id)).toEqual(['v1']);
  });

  it('re-evaluates visible() on every call instead of trusting stale state', () => {
    let on = false;
    svc.registerAction(
      base({ id: 'g', shortcut: 'Mod+G', context: ActionContext.CORE, visible: () => on }) as any,
    );
    expect(svc.getShortcutCandidates().find((a) => a.id === 'g')).toBeUndefined();
    on = true;
    expect(svc.getShortcutCandidates().find((a) => a.id === 'g')).toBeDefined();
  });

  it('excludes disabled actions', () => {
    svc.registerAction(base({ id: 'dis', shortcut: 'Mod+D', disabled: true }) as any);
    svc.setContext(ActionContext.EXTENSION_VIEW, 'notes');
    expect(svc.getShortcutCandidates()).toEqual([]);
  });

  it('lists view-scoped actions before global/core ones so the view wins a tie', () => {
    svc.registerAction(
      base({
        id: 'core',
        shortcut: 'Mod+J',
        context: ActionContext.GLOBAL,
        extensionId: undefined,
      }) as any,
    );
    svc.registerAction(base({ id: 'view', shortcut: 'Mod+J' }) as any);
    svc.setContext(ActionContext.EXTENSION_VIEW, 'notes');
    expect(svc.getShortcutCandidates().map((a) => a.id)).toEqual(['view', 'core']);
  });
});
