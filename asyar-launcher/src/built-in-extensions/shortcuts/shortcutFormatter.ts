// DOM key names for modifier keys (KeyboardEvent.key values)
export const MODIFIER_KEYS = ['Meta', 'Shift', 'Alt', 'Control'];

export function toDisplayString(s: string): string {
  return s
    .replace('Super', '⌘')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace('Control', '⌃')
    .replace(/\+/g, '');
}

export function fromKeyboardEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.includes(e.key)) {
    return null;
  }

  const parts = [];
  if (e.metaKey) parts.push('Super');
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key.toUpperCase();
  if (key === ' ') key = 'Space';

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
