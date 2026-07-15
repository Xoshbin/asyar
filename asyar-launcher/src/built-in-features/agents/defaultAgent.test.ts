import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAMMAR_FIX_HOTKEY } from './defaultAgent';

describe('DEFAULT_GRAMMAR_FIX_HOTKEY', () => {
  it('uses Rust-compatible shortcut tokens', () => {
    expect(DEFAULT_GRAMMAR_FIX_HOTKEY).toEqual({ modifier: 'Super+Shift', key: 'L' });
  });
});
