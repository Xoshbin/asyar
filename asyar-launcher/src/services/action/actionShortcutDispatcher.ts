/**
 * The single owner of key → action dispatch.
 *
 * An action's `shortcut` is a declaration, not a hint: this dispatcher is the
 * only code that turns a key press into an action run, for every source of
 * actions (built-in views, core actions in root search, Tier 2 runtime actions). Feature code declares `shortcut` on the
 * action and installs no `keydown` listener of its own for it.
 *
 * It is pure with respect to the app: the candidate set, the runner and the
 * "is something modal on top" probe are injected, so `launcherKeyboard` wires
 * it into the one window-level keydown handler and tests drive it directly.
 *
 * Candidates are whatever `ActionService.getShortcutCandidates()` returns: the
 * actions visible in the current context, view-scoped ones first. That makes
 * context handling and collision resolution a single rule — the first
 * candidate with the chord wins — rather than something every feature
 * reimplements.
 */
import { isAnyModalOpen } from '../../components/base/Modal.logic';
import {
  RESERVED_ACTION_SHORTCUTS,
  actionShortcutMatchesChord,
  eventToActionChord,
  resolveActionChord,
  type ActionShortcutPlatform,
} from '../../lib/keyboard/actionShortcut';

export interface DispatchableAction {
  id: string;
  label: string;
  shortcut?: string;
  confirm?: boolean;
}

export interface ActionShortcutDispatcherDeps {
  /** Visible actions for the current context, highest priority first. */
  getCandidates: () => readonly DispatchableAction[];
  /** Runs the matched action (confirm dialog, execute, failure feedback). */
  run: (action: DispatchableAction, opts: { reportSuccess: boolean }) => Promise<void> | void;
  platform: ActionShortcutPlatform;
  /** True while the ⌘K panel or a modal owns the keyboard. */
  isSuppressed: () => boolean;
  /** Optional gate for bare `Enter` dispatch (defaults to allowing the main search input and non-interactive elements). */
  canDispatchEnter?: (event: KeyboardEvent) => boolean;
  /** Optional probe for active text selection (used on Windows/Linux so Ctrl+X runs native Cut when text is selected). */
  hasTextSelection?: () => boolean;
  /** Dev-time diagnostics for colliding declarations. */
  warn: (message: string) => void;
}

/** True when the focused DOM element currently holds a non-empty text selection. */
export function hasFocusedTextSelection(doc: Document | undefined): boolean {
  if (!doc) return false;
  const active = doc.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName?.toLowerCase();
  if (tag === 'textarea') {
    const ta = active as HTMLTextAreaElement;
    return ta.selectionStart !== ta.selectionEnd;
  }
  if (tag === 'input') {
    const inp = active as HTMLInputElement;
    try {
      return (
        inp.selectionStart !== null &&
        inp.selectionEnd !== null &&
        inp.selectionStart !== inp.selectionEnd
      );
    } catch {
      return false;
    }
  }
  if (active.isContentEditable) {
    const sel = doc.defaultView?.getSelection?.();
    return Boolean(sel && !sel.isCollapsed && sel.toString().length > 0);
  }
  return false;
}

function isInteractiveElement(active: HTMLElement | null, doc: Document | undefined): boolean {
  if (!active || active === doc?.querySelector('input.search-input-clean')) return false;
  const tag = active.tagName?.toLowerCase();
  if (['input', 'textarea', 'select', 'button', 'a'].includes(tag)) return true;
  if (active.isContentEditable) return true;
  return Boolean(
    active.closest?.('button, a[href], [role="button"], [role="menuitem"], [role="option"]'),
  );
}

export interface ActionShortcutDispatcher {
  /** Returns true when the event was an action shortcut and was consumed. */
  handle(event: KeyboardEvent): boolean;
  /**
   * Physical chords (`Super+N` / `Control+N`) of the current candidates, for a
   * consumer that only sees raw modifier flags: the Tier 2 iframe forwarder.
   */
  activeChords(): string[];
  /**
   * True when a visible, enabled action in the current context declares `Enter`,
   * so Tier 2 iframes know to forward bare `Enter` from non-interactive areas.
   */
  hasEnterCandidate?(): boolean;
}

/** The ⌘K action panel mounts `.action-popup` for as long as it is open. */
export function isActionPanelDomOpen(doc: Document): boolean {
  return doc.querySelector('.action-popup') !== null;
}

/** Whether the ⌘K panel or a modal dialog sits on top of the launcher. */
export function isActionOverlayOpen(doc: Document): boolean {
  return isActionPanelDomOpen(doc) || isAnyModalOpen(doc);
}

export function createActionShortcutDispatcher(
  deps: ActionShortcutDispatcherDeps,
): ActionShortcutDispatcher {
  const warned = new Set<string>();

  function handle(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing) return false;
    const chord = eventToActionChord(event, deps.platform);
    if (!chord) return false;
    if (chord === 'Enter') {
      const allowed = deps.canDispatchEnter
        ? deps.canDispatchEnter(event)
        : !isInteractiveElement(
            typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
            typeof document !== 'undefined' ? document : undefined,
          ) &&
          !isInteractiveElement(
            event.target as HTMLElement | null,
            typeof document !== 'undefined' ? document : undefined,
          );
      if (!allowed) return false;
    }
    const allowConditionalCut = deps.platform !== 'macos' && chord === 'Mod+X';
    // Reserved chords belong to the launcher or to the focused text field. They
    // can never be registered, so this only guards against a stale candidate.
    if (RESERVED_ACTION_SHORTCUTS.has(chord) && !allowConditionalCut) return false;
    if (allowConditionalCut) {
      const selected = deps.hasTextSelection
        ? deps.hasTextSelection()
        : hasFocusedTextSelection(typeof document !== 'undefined' ? document : undefined);
      if (selected) return false;
    }
    if (deps.isSuppressed()) return false;

    const matches = deps
      .getCandidates()
      .filter((a) => actionShortcutMatchesChord(a.shortcut, chord, deps.platform));
    if (matches.length === 0) return false;

    if (matches.length > 1 && !warned.has(chord)) {
      warned.add(chord);
      deps.warn(
        `Shortcut ${chord} is bound by ${matches.length} visible actions (${matches
          .map((a) => a.id)
          .join(', ')}); running '${matches[0].id}'`,
      );
    }

    event.preventDefault();
    event.stopPropagation();
    // A held key repeats keydown; swallow it so it neither types nor re-runs.
    if (event.repeat) return true;

    // Start the action inside the keydown (some actions need the user gesture)
    // but never wait on it: a failing action reports through its own feedback
    // path, so a rejection here would only be an unhandled one.
    try {
      void Promise.resolve(deps.run(matches[0], { reportSuccess: false })).catch(() => {});
    } catch {
      // A synchronous throw is handled the same way.
    }
    return true;
  }

  function activeChords(): string[] {
    const chords = new Set<string>();
    for (const a of deps.getCandidates()) {
      if (!a.shortcut || a.shortcut === 'Enter') continue;
      chords.add(resolveActionChord(a.shortcut, deps.platform));
    }
    return [...chords];
  }

  function hasEnterCandidate(): boolean {
    return deps
      .getCandidates()
      .some((a) => actionShortcutMatchesChord(a.shortcut, 'Enter', deps.platform));
  }

  return { handle, activeChords, hasEnterCandidate };
}
