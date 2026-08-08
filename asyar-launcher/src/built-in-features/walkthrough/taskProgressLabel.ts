import type { TaskProgress } from '../../lib/ipc/walkthroughCommands';

/**
 * Null when a label would say nothing the tick mark doesn't: a manual task,
 * or a single-step one where "0 of 1" just means "not done".
 */
export function taskProgressLabel(progress: TaskProgress | null | undefined): string | null {
  if (!progress || progress.target <= 1) return null;

  const { current, target, unit } = progress;
  switch (unit) {
    case 'days':
      return `${current} of ${target} days`;
    case 'launches':
      return `${current} of ${target} times`;
    default:
      return `${current} of ${target}`;
  }
}

/** Fill fraction for MeterBar, 0..1. */
export function taskProgressFraction(progress: TaskProgress | null | undefined): number {
  if (!progress || progress.target <= 0) return 0;
  return Math.max(0, Math.min(1, progress.current / progress.target));
}
