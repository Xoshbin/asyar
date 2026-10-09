// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createActionShortcutDispatcher,
  isActionPanelDomOpen,
  type DispatchableAction,
} from './actionShortcutDispatcher';
import type { ActionShortcutPlatform } from '../../lib/keyboard/actionShortcut';

const action = (id: string, shortcut: string, over: Partial<DispatchableAction> = {}) =>
  ({ id, label: id, shortcut, ...over }) as DispatchableAction;

const key = (init: KeyboardEventInit & { code?: string }) =>
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });

function setup(
  actions: DispatchableAction[],
  opts: { platform?: ActionShortcutPlatform; suppressed?: boolean } = {},
) {
  const run = vi.fn().mockResolvedValue(undefined);
  const warn = vi.fn();
  const dispatcher = createActionShortcutDispatcher({
    getCandidates: () => actions,
    run,
    platform: opts.platform ?? 'macos',
    isSuppressed: () => opts.suppressed ?? false,
    warn,
  });
  return { dispatcher, run, warn };
}

describe('createActionShortcutDispatcher', () => {
  describe('matching', () => {
    it('runs the action whose shortcut matches and consumes the event', () => {
      const { dispatcher, run } = setup([action('notes:add', 'Mod+N')]);
      const e = key({ key: 'n', code: 'KeyN', metaKey: true });
      expect(dispatcher.handle(e)).toBe(true);
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0][0].id).toBe('notes:add');
      expect(e.defaultPrevented).toBe(true);
    });

    it('stops propagation so no other listener double-handles the chord', () => {
      const { dispatcher } = setup([action('a', 'Mod+N')]);
      const e = key({ key: 'n', code: 'KeyN', metaKey: true });
      const stop = vi.spyOn(e, 'stopPropagation');
      dispatcher.handle(e);
      expect(stop).toHaveBeenCalled();
    });

    it('ignores keys no candidate declares and leaves the event alone', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')]);
      const e = key({ key: 'm', code: 'KeyM', metaKey: true });
      expect(dispatcher.handle(e)).toBe(false);
      expect(run).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });

    it('matches modifier combinations exactly', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+Shift+C')]);
      expect(dispatcher.handle(key({ key: 'c', code: 'KeyC', metaKey: true }))).toBe(false);
      expect(
        dispatcher.handle(key({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true })),
      ).toBe(true);
      expect(run).toHaveBeenCalledOnce();
    });

    it('matches punctuation by physical key', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+Shift+,')]);
      expect(
        dispatcher.handle(key({ key: '<', code: 'Comma', metaKey: true, shiftKey: true })),
      ).toBe(true);
      expect(run).toHaveBeenCalledOnce();
    });

    it('does nothing when there are no candidates', () => {
      const { dispatcher, run } = setup([]);
      expect(dispatcher.handle(key({ key: 'n', code: 'KeyN', metaKey: true }))).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('platform modifier', () => {
    it('binds Mod to ⌘ on macOS and does not fire on Ctrl', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')], { platform: 'macos' });
      expect(dispatcher.handle(key({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('binds Mod to Ctrl on Windows and Linux and does not fire on the Windows key', () => {
      for (const platform of ['windows', 'other'] as ActionShortcutPlatform[]) {
        const { dispatcher, run } = setup([action('a', 'Mod+N')], { platform });
        expect(dispatcher.handle(key({ key: 'n', code: 'KeyN', metaKey: true }))).toBe(false);
        expect(dispatcher.handle(key({ key: 'n', code: 'KeyN', ctrlKey: true }))).toBe(true);
        expect(run).toHaveBeenCalledOnce();
      }
    });
  });

  describe('suppression', () => {
    it('does not run anything while an overlay (⌘K panel or modal) is open', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')], { suppressed: true });
      const e = key({ key: 'n', code: 'KeyN', metaKey: true });
      expect(dispatcher.handle(e)).toBe(false);
      expect(run).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(false);
    });

    it('ignores events another handler already consumed', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')]);
      const e = key({ key: 'n', code: 'KeyN', metaKey: true, cancelable: true });
      e.preventDefault();
      expect(dispatcher.handle(e)).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('ignores IME composition', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')]);
      const e = key({ key: 'n', code: 'KeyN', metaKey: true, isComposing: true });
      expect(dispatcher.handle(e)).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('swallows but does not re-run a held-down chord', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')]);
      const e = key({ key: 'n', code: 'KeyN', metaKey: true, repeat: true });
      expect(dispatcher.handle(e)).toBe(true);
      expect(run).not.toHaveBeenCalled();
      expect(e.defaultPrevented).toBe(true);
    });
  });

  describe('input safety', () => {
    it('never fires for plain typing keys, even when a matching letter is declared', () => {
      const { dispatcher, run } = setup([action('a', 'Mod+N')]);
      expect(dispatcher.handle(key({ key: 'n', code: 'KeyN' }))).toBe(false);
      expect(dispatcher.handle(key({ key: 'N', code: 'KeyN', shiftKey: true }))).toBe(false);
      expect(dispatcher.handle(key({ key: 'Enter', code: 'Enter' }))).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('lets text-editing chords reach the focused input untouched', () => {
      // Registration rejects these chords, so even a stale/forged candidate list
      // must not make the dispatcher steal them.
      const { dispatcher, run } = setup([
        action('bad-a', 'Mod+A'),
        action('bad-c', 'Mod+C'),
        action('bad-z', 'Mod+Z'),
      ]);
      for (const [k, code] of [
        ['a', 'KeyA'],
        ['c', 'KeyC'],
        ['z', 'KeyZ'],
      ]) {
        const e = key({ key: k, code, metaKey: true });
        expect(dispatcher.handle(e)).toBe(false);
        expect(e.defaultPrevented).toBe(false);
      }
      expect(run).not.toHaveBeenCalled();
    });

    it('does not take launcher-reserved chords', () => {
      const { dispatcher, run } = setup([action('bad-k', 'Mod+K'), action('bad-p', 'Mod+P')]);
      expect(dispatcher.handle(key({ key: 'k', code: 'KeyK', metaKey: true }))).toBe(false);
      expect(dispatcher.handle(key({ key: 'p', code: 'KeyP', metaKey: true }))).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('fires a Mod chord even while a text field is focused', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      const { dispatcher, run } = setup([action('a', 'Mod+N')]);
      expect(dispatcher.handle(key({ key: 'n', code: 'KeyN', metaKey: true }))).toBe(true);
      expect(run).toHaveBeenCalledOnce();
      input.remove();
    });
  });

  describe('collisions', () => {
    it('runs only the first candidate, so a view action beats a core one', () => {
      const { dispatcher, run, warn } = setup([action('view', 'Mod+J'), action('core', 'Mod+J')]);
      dispatcher.handle(key({ key: 'j', code: 'KeyJ', metaKey: true }));
      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0][0].id).toBe('view');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Mod+J'));
    });

    it('warns once per colliding chord, not on every press', () => {
      const { dispatcher, warn } = setup([action('a', 'Mod+J'), action('b', 'Mod+J')]);
      for (let i = 0; i < 3; i++) dispatcher.handle(key({ key: 'j', code: 'KeyJ', metaKey: true }));
      expect(warn).toHaveBeenCalledOnce();
    });
  });

  describe('failures', () => {
    it('does not let a rejected action become an unhandled rejection', async () => {
      const run = vi.fn().mockRejectedValue(new Error('boom'));
      const dispatcher = createActionShortcutDispatcher({
        getCandidates: () => [action('a', 'Mod+N')],
        run,
        platform: 'macos',
        isSuppressed: () => false,
        warn: vi.fn(),
      });
      expect(dispatcher.handle(key({ key: 'n', code: 'KeyN', metaKey: true }))).toBe(true);
      await Promise.resolve();
    });
  });

  describe('active chord set', () => {
    it('lists the physical chords the Tier 2 iframe should forward', () => {
      const { dispatcher } = setup(
        [action('a', 'Mod+N'), action('b', 'Mod+Shift+C'), action('c', 'F5')],
        { platform: 'macos' },
      );
      expect(dispatcher.activeChords().sort()).toEqual(['F5', 'Super+N', 'Super+Shift+C']);
    });

    it('resolves Mod to Control off macOS and de-duplicates', () => {
      const { dispatcher } = setup([action('a', 'Mod+N'), action('b', 'Mod+N')], {
        platform: 'windows',
      });
      expect(dispatcher.activeChords()).toEqual(['Control+N']);
    });
  });
});

describe('isActionPanelDomOpen', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('is true while the ⌘K popup is mounted', () => {
    expect(isActionPanelDomOpen(document)).toBe(false);
    document.body.innerHTML = '<div class="action-popup"></div>';
    expect(isActionPanelDomOpen(document)).toBe(true);
  });
});
