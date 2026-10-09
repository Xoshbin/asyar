/**
 * The one grammar for an action's `shortcut`.
 *
 * A shortcut declared on an action, from any source (manifest, built-in
 * registration, Tier 2 runtime registration), both renders its hint and binds
 * the key. This module owns what a declared string may look like and how a
 * physical key press is turned back into that form, so the hint and the
 * binding can never disagree.
 *
 * Canonical form: `Mod[+Alt][+Shift]+Key`, or a bare `F1`–`F24`.
 *  - `Mod` is the platform's primary modifier: ⌘ on macOS, Ctrl on Windows and
 *    Linux. It is the only way to say "the usual modifier"; literal `Super`,
 *    `Control`, `Cmd`, `Ctrl` and the ⌘ glyph are rejected rather than aliased.
 *  - Modifiers appear in the fixed order Mod, Alt, Shift.
 *  - The key is an uppercase letter or digit, one of `, . / ; ' [ ] \ - = \``,
 *    `Space` or `Enter`.
 *  - A chord needs `Mod`: plain keys (and Shift/Alt-only chords, which type
 *    characters) belong to text entry and list navigation, never to actions.
 *    F-keys are the one bare-key exception.
 *
 * Rust mirrors this grammar for Tier 2 manifests
 * (`extensions::validate_action_shortcut`); keep the two test tables in sync.
 */
import { MODIFIER_KEYS, keyFromEvent } from '../../built-in-features/shortcuts/shortcutFormatter';
import type { HostPlatform } from './hostPlatform';

export type ActionShortcutPlatform = HostPlatform;

const F_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const PUNCTUATION = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`']);
const NAMED_KEYS = new Set(['Space', 'Enter']);
const MODIFIER_ORDER = ['Mod', 'Alt', 'Shift'];

/**
 * Chords the launcher or the OS text field already owns. An action may never
 * bind them: the launcher handlers run first and would silently win, and the
 * text-editing ones must reach the focused input (rule 07).
 */
export const RESERVED_ACTION_SHORTCUTS: ReadonlyMap<string, string> = new Map([
  ['Mod+K', 'toggles the action panel'],
  ['Mod+,', 'opens Settings'],
  ['Mod+P', 'toggles the search-bar accessory'],
  ['Mod+Q', 'is blocked so the launcher is not quit by accident'],
  ['Mod+A', 'is select-all in text fields'],
  ['Mod+C', 'is copy in text fields'],
  ['Mod+V', 'is paste in text fields'],
  ['Mod+X', 'is cut in text fields'],
  ['Mod+Z', 'is undo in text fields'],
  ['Mod+Y', 'is redo in text fields'],
  ['Mod+Shift+Z', 'is redo in text fields'],
]);

function isKey(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || PUNCTUATION.has(key) || NAMED_KEYS.has(key) || F_KEY.test(key);
}

/** `null` when `shortcut` is a valid canonical action shortcut, else why not. */
export function validateActionShortcut(shortcut: string): string | null {
  if (typeof shortcut !== 'string' || shortcut === '') return 'shortcut is empty';
  if (/\s/.test(shortcut)) return 'shortcut must not contain whitespace';
  if (F_KEY.test(shortcut)) return null;

  const parts = shortcut.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (key === '') return 'shortcut is missing its key';
  if (!isKey(key)) {
    return `'${key}' is not a bindable key (use an uppercase letter or digit, punctuation, Space, Enter or F1–F24)`;
  }
  for (const m of modifiers) {
    if (!MODIFIER_ORDER.includes(m)) {
      return `'${m}' is not a valid modifier (use Mod, Alt and Shift; Mod is ⌘ on macOS and Ctrl elsewhere)`;
    }
  }
  if (new Set(modifiers).size !== modifiers.length) return 'shortcut repeats a modifier';
  if (!modifiers.includes('Mod')) {
    return 'shortcut must include Mod; plain keys and Shift/Alt-only chords are reserved for typing and navigation';
  }
  const ordered = [...modifiers].sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b),
  );
  if (ordered.join('+') !== modifiers.join('+')) {
    return `modifiers must be ordered Mod, Alt, Shift (write '${[...ordered, key].join('+')}')`;
  }
  const reserved = RESERVED_ACTION_SHORTCUTS.get(shortcut);
  if (reserved) return `${shortcut} is reserved: it ${reserved}`;
  return null;
}

/** Throws if `shortcut` is not a valid canonical action shortcut. */
export function assertActionShortcut(shortcut: string, actionId: string): void {
  const problem = validateActionShortcut(shortcut);
  if (problem)
    throw new Error(`Action '${actionId}' has invalid shortcut '${shortcut}': ${problem}`);
}

/**
 * The canonical chord a keydown event represents on `platform`, or `null` when
 * the event cannot be an action shortcut (a lone modifier, a plain key, or the
 * non-primary modifier held: macOS Ctrl+N and Windows-key chords are never
 * `Mod+N`, so they keep their native meaning).
 */
export function eventToActionChord(
  e: KeyboardEvent,
  platform: ActionShortcutPlatform,
): string | null {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  const mac = platform === 'macos';
  const primary = mac ? e.metaKey : e.ctrlKey;
  const foreign = mac ? e.ctrlKey : e.metaKey;
  if (foreign) return null;

  const key = keyFromEvent(e);
  if (!primary) return F_KEY.test(key) && !e.altKey && !e.shiftKey ? key : null;

  const parts = ['Mod'];
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/**
 * The same chord spelled with the physical modifier, for consumers that only
 * see raw modifier flags (the Tier 2 iframe forwarder): `Super` on macOS,
 * `Control` elsewhere, then Alt, Shift.
 */
export function resolveActionChord(shortcut: string, platform: ActionShortcutPlatform): string {
  return shortcut.replace(/^Mod\b/, platform === 'macos' ? 'Super' : 'Control');
}
