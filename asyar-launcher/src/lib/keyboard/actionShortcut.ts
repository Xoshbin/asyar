/**
 * The one grammar for an action's `shortcut`.
 *
 * A shortcut declared on an action, from any source (manifest, built-in
 * registration, Tier 2 runtime registration), both renders its hint and binds
 * the key. This module owns what a declared string may look like and how a
 * physical key press is turned back into that form, so the hint and the
 * binding can never disagree.
 *
 * Canonical form: `Mod[+Alt][+Shift]+Key`, bare `F1`–`F24`, `Enter`, `Alt+Enter`,
 * `Control+Mod+Enter` (macOS Paste as Plain Text), or approved destructive delete
 * chords (`Control+X`, `Control+Shift+X`).
 *  - `Mod` is the platform's primary modifier: ⌘ on macOS, Ctrl on Windows and
 *    Linux. It is the only way to say "the usual modifier"; literal `Super`,
 *    `Control`, `Cmd`, `Ctrl` and the ⌘ glyph are rejected rather than aliased
 *    (except for the approved `Control+X`, `Control+Shift+X`, and `Control+Mod+Enter` chords).
 *  - Modifiers appear in the fixed order Control, Mod, Alt, Shift.
 *  - The key is an uppercase letter or digit, one of `, . / ; ' [ ] \ - = \``,
 *    or `Enter`.
 *  - Plain keys and Shift/Alt-only chords belong to text entry and list
 *    navigation, never to actions — with F-keys, bare `Enter`, and `Alt+Enter`
 *    as the explicit exceptions.
 *
 * Built-ins that break it throw at registration; a Tier 2 extension's action
 * keeps loading with the shortcut dropped (see `ActionService.admitShortcut`).
 */
import { MODIFIER_KEYS, keyFromEvent } from '../../built-in-features/shortcuts/shortcutFormatter';
import type { HostPlatform } from './hostPlatform';

export type ActionShortcutPlatform = HostPlatform;

const F_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;
const PUNCTUATION = new Set([',', '.', '/', ';', "'", '[', ']', '\\', '-', '=', '`']);
const NAMED_KEYS = new Set(['Enter']);
const MODIFIER_ORDER = ['Control', 'Mod', 'Alt', 'Shift'];
const APPROVED_CONTROL_CHORDS = new Set(['Control+X', 'Control+Shift+X', 'Control+Mod+Enter']);

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
  ['Mod+Shift+Z', 'is redo in text fields'],
]);

function isKey(key: string): boolean {
  return /^[A-Z0-9]$/.test(key) || PUNCTUATION.has(key) || NAMED_KEYS.has(key) || F_KEY.test(key);
}

/** `null` when `shortcut` is a valid canonical action shortcut, else why not. */
export function validateActionShortcut(shortcut: string): string | null {
  if (typeof shortcut !== 'string' || shortcut === '') return 'shortcut is empty';
  if (/\s/.test(shortcut)) return 'shortcut must not contain whitespace';
  if (F_KEY.test(shortcut) || shortcut === 'Enter') return null;

  const parts = shortcut.split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  if (key === '') return 'shortcut is missing its key';
  if (!isKey(key)) {
    return `'${key}' is not a bindable key (use an uppercase letter or digit, punctuation, Enter or F1–F24)`;
  }
  for (const m of modifiers) {
    if (!MODIFIER_ORDER.includes(m)) {
      return `'${m}' is not a valid modifier (use Control, Mod, Alt and Shift; Mod is ⌘ on macOS and Ctrl elsewhere)`;
    }
  }
  if (new Set(modifiers).size !== modifiers.length) return 'shortcut repeats a modifier';
  const ordered = [...modifiers].sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b),
  );
  if (ordered.join('+') !== modifiers.join('+')) {
    return `modifiers must be ordered Control, Mod, Alt, Shift (write '${[...ordered, key].join('+')}')`;
  }
  if (modifiers.includes('Control')) {
    if (!APPROVED_CONTROL_CHORDS.has(shortcut)) {
      return `use Mod instead of Control for portable shortcuts (Control is only valid for Control+X, Control+Shift+X, and Control+Mod+Enter)`;
    }
    return null;
  }
  if (!modifiers.includes('Mod')) {
    if (key === 'Enter' && modifiers.length === 1 && modifiers[0] === 'Alt') {
      return null;
    }
    return 'shortcut must include Mod; plain keys and Shift/Alt-only chords are reserved for typing and navigation';
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
 * The key an action chord is matched on. Letters and digits follow the
 * keyboard layout, as the OS and browser do for ⌘C/⌘V: on Dvorak the key that
 * types "c" must stay copy, never become another action. Anything that is not
 * an ASCII letter or digit (punctuation, shifted symbols, ⌥-composed or
 * non-Latin characters) falls back to the physical key.
 */
function actionKeyFromEvent(e: KeyboardEvent): string {
  if (e.key.length === 1) {
    const upper = e.key.toUpperCase();
    if (/^[A-Z0-9]$/.test(upper)) return upper;
  }
  return keyFromEvent(e);
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
  // AltGr arrives as Ctrl+Alt on Windows (and sets AltGraph elsewhere); it types
  // characters, so it is never an action chord.
  if (e.getModifierState?.('AltGraph')) return null;
  const mac = platform === 'macos';
  const key = actionKeyFromEvent(e);

  if (mac) {
    if (e.ctrlKey && e.metaKey) {
      return !e.altKey && !e.shiftKey && key === 'Enter' ? 'Control+Mod+Enter' : null;
    }
    if (e.ctrlKey && !e.metaKey) {
      if (e.altKey || key !== 'X') return null;
      return e.shiftKey ? 'Control+Shift+X' : 'Control+X';
    }
    if (!e.metaKey) {
      if (key === 'Enter' && !e.shiftKey) return e.altKey ? 'Alt+Enter' : 'Enter';
      return F_KEY.test(key) && !e.altKey && !e.shiftKey ? key : null;
    }
  } else {
    if (e.metaKey) return null;
    if (!e.ctrlKey) {
      if (key === 'Enter' && !e.shiftKey) return e.altKey ? 'Alt+Enter' : 'Enter';
      return F_KEY.test(key) && !e.altKey && !e.shiftKey ? key : null;
    }
  }

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
  return shortcut.replace(/\bMod\b/, platform === 'macos' ? 'Super' : 'Control');
}

/**
 * Whether an action's declared `shortcut` matches the chord from `eventToActionChord`
 * on `platform`. On Windows/Linux, `Control+X` and `Control+Shift+X` map to the same
 * physical `Ctrl+X` / `Ctrl+Shift+X` key press as `Mod+X` / `Mod+Shift+X`, while still
 * never allowing a literal `Mod+X` declaration to match.
 */
export function actionShortcutMatchesChord(
  actionShortcut: string | undefined,
  chord: string,
  platform: ActionShortcutPlatform,
): boolean {
  if (!actionShortcut || RESERVED_ACTION_SHORTCUTS.has(actionShortcut)) return false;
  if (actionShortcut === chord) return true;
  if (platform !== 'macos') {
    if (actionShortcut === 'Control+X' && chord === 'Mod+X') return true;
    if (actionShortcut === 'Control+Shift+X' && chord === 'Mod+Shift+X') return true;
  }
  return false;
}
