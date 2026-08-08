import type { TaskProgress } from '../../lib/ipc/walkthroughCommands';

/**
 * "2 of 3 days" for a task that is partway there.
 *
 * Returns null when a bar would say nothing the tick mark doesn't already:
 * a manual task (no progress at all) or a single-step one, where "0 of 1" is
 * just a longer way of writing "not done".
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
