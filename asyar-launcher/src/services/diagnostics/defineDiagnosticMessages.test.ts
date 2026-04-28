import { describe, expect, it } from 'vitest';
import { defineDiagnosticMessages } from './defineDiagnosticMessages';
import { DIAGNOSTIC_KINDS } from './kinds';

describe('defineDiagnosticMessages', () => {
  it('exhaustively covers DIAGNOSTIC_KINDS at runtime', () => {
    const reg = defineDiagnosticMessages(
      Object.fromEntries(DIAGNOSTIC_KINDS.map((k) => [k, () => k])) as any,
    );
    for (const k of DIAGNOSTIC_KINDS) {
      expect(typeof reg[k]).toBe('function');
    }
  });

  it('renders templates with a context object', () => {
    const reg = defineDiagnosticMessages(
      Object.fromEntries(
        DIAGNOSTIC_KINDS.map((k) => [k, (ctx: Record<string, string>) => `${k}:${ctx.x ?? ''}`]),
      ) as any,
    );
    expect(reg.permission_denied({ x: 'a' })).toBe('permission_denied:a');
  });
});
