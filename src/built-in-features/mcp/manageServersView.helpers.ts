export function formatRelativeTime(timestampMillis: number, now: number = Date.now()): string {
  const diffMs = now - timestampMillis;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMs / 3_600_000);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffMs / 86_400_000);
  return `${diffDay}d ago`;
}

export function statusBadgeColor(
  status: 'starting' | 'connected' | 'failed' | 'disabled',
): string {
  switch (status) {
    case 'connected': return 'var(--accent-success)';
    case 'starting': return 'var(--accent-warning)';
    case 'failed': return 'var(--accent-danger)';
    case 'disabled': return 'var(--text-tertiary)';
  }
}

export function transportLabel(kind: string): string {
  if (kind === 'stdio') return 'Stdio';
  if (kind === 'http') return 'HTTP';
  return kind;
}

export function truncateArgs(s: string, max: number = 80): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}
