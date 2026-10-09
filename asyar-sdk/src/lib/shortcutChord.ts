/**
 * Turns a keydown into the physical chord string the launcher announces for
 * its active action shortcuts (`Super+Shift+N` on macOS, `Control+N`
 * elsewhere: primary modifier, then Alt, then Shift, then the key).
 *
 * The launcher resolves each action's platform-neutral `Mod+…` shortcut to
 * this spelling before sending it, so the iframe never needs to know the
 * platform: whichever of ⌘/Ctrl it sees pressed is the one it compares.
 * Plain keys and Shift/Alt-only chords are typing, never an action shortcut,
 * so they yield `null`; a bare F-key is the one exception.
 */
const CODE_TO_KEY: Record<string, string> = {
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Space: 'Space',
  Enter: 'Enter',
};

function physicalKey(e: KeyboardEvent): string {
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (CODE_TO_KEY[code]) return CODE_TO_KEY[code];
  if (e.key === ' ' || e.key === 'Spacebar') return 'Space';
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'OS']);

export function chordFromKeyboardEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  if (e.metaKey && e.ctrlKey) return null;
  const key = physicalKey(e);
  const primary = e.metaKey ? 'Super' : e.ctrlKey ? 'Control' : null;
  if (!primary) {
    return /^F([1-9]|1[0-9]|2[0-4])$/.test(key) && !e.altKey && !e.shiftKey ? key : null;
  }
  const parts = [primary];
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
