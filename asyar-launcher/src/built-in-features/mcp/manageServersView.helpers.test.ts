import { describe, it, expect } from 'vitest';
import {
  formatRelativeTime,
  statusBadgeColor,
  transportLabel,
  truncateArgs,
} from './manageServersView.helpers';

describe('formatRelativeTime', () => {
  it("returns 'just now' for <60s", () => {
    const now = 1_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
  });

  it("returns 'Nm ago' for minutes", () => {
    const now = 1_000_000;
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
  });

  it("returns 'Nh ago' for hours", () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });

  it("returns 'Nd ago' for days", () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('statusBadgeColor', () => {
  it('maps connected/starting/failed/disabled correctly', () => {
    expect(statusBadgeColor('connected')).toContain('success');
    expect(statusBadgeColor('starting')).toContain('warning');
    expect(statusBadgeColor('failed')).toContain('danger');
    expect(statusBadgeColor('disabled')).toBeTruthy();
  });
});

describe('transportLabel', () => {
  it("maps 'stdio' → 'Stdio'", () => {
    expect(transportLabel('stdio')).toBe('Stdio');
  });

  it("maps 'http' → 'HTTP'", () => {
    expect(transportLabel('http')).toBe('HTTP');
  });

  it('passes through unknown kinds as-is', () => {
    expect(transportLabel('custom')).toBe('custom');
  });
});

describe('truncateArgs', () => {
  it('caps at 80 chars with ellipsis', () => {
    const long = 'x'.repeat(100);
    const result = truncateArgs(long);
    expect(result.length).toBe(81);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns short strings as-is', () => {
    expect(truncateArgs('short')).toBe('short');
  });
});
