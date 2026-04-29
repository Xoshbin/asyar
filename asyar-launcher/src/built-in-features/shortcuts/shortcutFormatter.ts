export const MODIFIER_KEYS = ['Meta', 'Shift', 'Alt', 'Control'];

export const DOM_TO_MODIFIER: Record<string, string> = {
  Meta: 'Super',
  Shift: 'Shift',
  Alt: 'Alt',
  Control: 'Control',
};

export const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Super'];

export const MODIFIER_SYMBOL: Record<string, string> = {
  Super: '⌘',
  Shift: '⇧',
  Alt: '⌥',
  Control: '⌃',
};

export const CODE_TO_KEY: Record<string, string> = {
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F',
  KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  KeyM: 'M', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R',
  KeyS: 'S', KeyT: 'T', KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X',
  KeyY: 'Y', KeyZ: 'Z',
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  Space: 'Space',
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`',
  Comma: ',', Period: '.', Slash: '/',
  Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
};

// Initially empty set, populated by shortcutService from Rust at startup
export const VALID_KEYS = new Set<string>();

export async function initValidKeys(): Promise<void> {
  if (VALID_KEYS.size > 0) return; // idempotent
  const { invoke } = await import('@tauri-apps/api/core');
  const keys = await invoke<string[]>('get_valid_shortcut_keys');
  for (const key of keys) VALID_KEYS.add(key);
}

export const KEY_DISPLAY: Record<string, string> = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

export function isValidKey(key: string): boolean {
  return VALID_KEYS.has(key);
}

export function toDisplayString(s: string): string {
  return s
    .replace('Super', '⌘')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace('Control', '⌃')
    .replace(/\+/g, '');
}

/** Splits a `Super+Shift+K` shortcut into per-chip glyphs: `['⌘', '⇧', 'K']`. */
export function toDisplayKeys(s: string): string[] {
  return s.split('+').map(part => MODIFIER_SYMBOL[part] ?? part);
}

export function fromKeyboardEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.includes(e.key)) {
    return null;
  }

  const parts: string[] = [];
  if (e.metaKey) parts.push('Super');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Use event.code for physical key mapping (unaffected by Shift)
  let key = CODE_TO_KEY[e.code] ?? null;
  if (!key) {
    key = e.key;
    if (key === ' ' || key === 'Spacebar') key = 'Space';
    else if (key.length === 1) key = key.toUpperCase();
  }

  parts.push(key);
  return parts.join('+');
}

export function parseShortcut(s: string): [string, string] {
  const parts = s.split('+');
  const key = parts.pop()!;
  return [parts.join('+'), key];
}

export function isValid(s: string): boolean {
  const parts = s.split('+');
  return parts.length >= 2 && parts.some(p => ['Super', 'Control', 'Alt', 'Shift'].includes(p));
}

/** Normalize a shortcut string so `Ctrl` → `Control` and modifiers are in canonical order. */
export function normalizeShortcut(s: string): string {
  const parts = s.replace(/\bCtrl\b/g, 'Control').split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...modifiers, key].join('+');
}
