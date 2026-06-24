import type { Run } from 'asyar-sdk/contracts';
import { formatElapsed } from '../../components/run/runningSectionLogic';

const ERROR_MESSAGE_MAX = 60;

/**
 * Produce a subtitle string for a run list item. Examples:
 *   "Running · 12s"
 *   "Succeeded · 5s"
 *   "Failed · exit code 1"
 *   "Cancelled"
 */
export function formatRunSubtitle(run: Run): string {
  switch (run.status) {
    case 'running':
    case 'pending': {
      const elapsed = formatElapsed(Date.now() - run.startedAt);
      return `Running · ${elapsed}`;
    }
    case 'succeeded': {
      const duration = run.endedAt
        ? formatElapsed(run.endedAt - run.startedAt)
        : '';
      return duration ? `Succeeded · ${duration}` : 'Succeeded';
    }
    case 'failed': {
      const msg = run.errorMessage ?? 'unknown error';
      const truncated =
        msg.length > ERROR_MESSAGE_MAX
          ? `${msg.slice(0, ERROR_MESSAGE_MAX - 3)}...`
          : msg;
      return `Failed · ${truncated}`;
    }
    case 'cancelled':
      return 'Cancelled';
  }
}
