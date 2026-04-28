/**
 * TS mirror of the Rust alias validation rules. The source of truth lives in
 * `src-tauri/src/aliases/models.rs::validate_alias`. A Rust contract test
 * loads this file via `include_str!` and asserts the regex/length constants
 * match.
 */
export const ALIAS_REGEX = /^[a-z0-9]{1,10}$/;
export const ALIAS_MAX_LEN = 10;

export type ValidateResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'invalid-chars' };

export function normalizeAlias(input: string): string {
  return input.trim().toLowerCase();
}

export function validateAlias(input: string): ValidateResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'empty' };
  const lowered = trimmed.toLowerCase();
  if (lowered.length > ALIAS_MAX_LEN) return { ok: false, reason: 'too-long' };
  if (!ALIAS_REGEX.test(lowered)) return { ok: false, reason: 'invalid-chars' };
  return { ok: true, normalized: lowered };
}
