import { describe, it, expect } from 'vitest';
import { extractErrorMessage } from './errors';

describe('extractErrorMessage', () => {
  it('returns "unknown error" for null/undefined', () => {
    expect(extractErrorMessage(null)).toBe('unknown error');
    expect(extractErrorMessage(undefined)).toBe('unknown error');
  });

  it('returns string as-is', () => {
    expect(extractErrorMessage('boom')).toBe('boom');
  });

  it('returns Error.message for Error instances', () => {
    expect(extractErrorMessage(new Error('thrown'))).toBe('thrown');
    expect(extractErrorMessage(new TypeError('wrong type'))).toBe('wrong type');
  });

  it('extracts developerDetail from Rust AppError-shaped Diagnostic', () => {
    const diagnostic = {
      source: 'rust',
      kind: 'mcp_permission_required',
      severity: 'warning',
      retryable: false,
      context: {},
      developerDetail: 'Tool call rejected by user',
    };
    expect(extractErrorMessage(diagnostic)).toBe('Tool call rejected by user');
  });

  it('falls back to message field when developerDetail missing', () => {
    expect(extractErrorMessage({ message: 'fallback message' })).toBe('fallback message');
  });

  it('falls back to error field when message missing', () => {
    expect(extractErrorMessage({ error: 'error field' })).toBe('error field');
  });

  it('JSON-stringifies plain objects with no known fields (never returns "[object Object]")', () => {
    const result = extractErrorMessage({ foo: 'bar', count: 3 });
    expect(result).not.toBe('[object Object]');
    expect(result).toBe('{"foo":"bar","count":3}');
  });

  it('handles unserialisable objects gracefully', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(extractErrorMessage(circular)).toBe('unserialisable error');
  });

  it('skips empty string fields and falls back to next', () => {
    expect(extractErrorMessage({ developerDetail: '', message: 'good' })).toBe('good');
  });
});
