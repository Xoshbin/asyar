import { describe, expect, it } from 'vitest';
import { resolveEscapeBehavior } from './escapeBehavior';

describe('resolveEscapeBehavior', () => {
  it.each([
    ['go-back', 'go-back'],
    ['hide-and-reset', 'hide-and-reset'],
    ['close-window', 'go-back'],
    [undefined, 'go-back'],
    ['unsupported', 'go-back'],
  ] as const)('normalizes %s to %s', (raw, expected) => {
    expect(resolveEscapeBehavior(raw)).toBe(expected);
  });
});
