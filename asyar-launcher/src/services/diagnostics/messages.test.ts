import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_MESSAGES } from './messages';
import { DIAGNOSTIC_KINDS } from './kinds';

describe('DIAGNOSTIC_MESSAGES', () => {
  it('has a template for every DiagnosticKind', () => {
    for (const kind of DIAGNOSTIC_KINDS) {
      expect(typeof DIAGNOSTIC_MESSAGES[kind]).toBe('function');
    }
  });

  it('returns non-empty strings', () => {
    for (const kind of DIAGNOSTIC_KINDS) {
      const msg = DIAGNOSTIC_MESSAGES[kind]({});
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('renders permission_denied with context', () => {
    expect(DIAGNOSTIC_MESSAGES.permission_denied({ permission: 'clipboard:read' }))
      .toBe('Access to clipboard:read was denied');
  });
});
