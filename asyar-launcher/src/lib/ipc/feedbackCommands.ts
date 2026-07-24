// asyar-launcher/src/lib/ipc/feedbackCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';

// ── Feedback submission ───────────────────────────────────────────────────────

export interface FeedbackInput {
  type: 'feedback' | 'crash';
  category?: 'idea' | 'bug' | 'other' | null;
  message?: string | null;
  email?: string | null;
}

// boolean (not void): feedbackSubmitService needs to know whether submission
// actually succeeded before showing the "thank you" confirmation.
export async function submitFeedback(input: FeedbackInput): Promise<boolean> {
  return invokeSafeVoid('submit_feedback', { input });
}

// ── Crash report prompt (Ask mode) ───────────────────────────────────────────

export interface CrashPayload {
  panic: string;
  backtrace: string;
  log_tail: string;
}

export async function getPendingCrash(): Promise<CrashPayload | null> {
  return invokeSafe<CrashPayload | null>('get_pending_crash');
}

export async function sendPendingCrash(email: string): Promise<void> {
  await invokeSafe('send_pending_crash', { email });
}

export async function dismissPendingCrash(): Promise<void> {
  await invokeSafe('dismiss_pending_crash');
}
