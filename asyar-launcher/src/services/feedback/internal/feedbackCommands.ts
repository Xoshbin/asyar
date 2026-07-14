import { invoke } from '@tauri-apps/api/core';

export type FeedbackSeverity = 'progress' | 'info' | 'success' | 'warning' | 'error' | 'fatal';

export interface FeedbackProgress {
  title: string;
  completed?: number;
  total?: number;
}

export interface FeedbackItem {
  id: string;
  source: 'rust' | 'frontend' | 'extension';
  kind: string;
  severity: FeedbackSeverity;
  retryable: boolean;
  context: Record<string, string>;
  developerDetail?: string;
  extensionId?: string;
  retryActionId?: string;
  reportActionId?: string;
  progress?: FeedbackProgress;
}

export type FeedbackDraft = Omit<FeedbackItem, 'id'>;

export function publish(draft: FeedbackDraft): Promise<string> {
  return invoke<string>('feedback_publish', { draft });
}

export function getCurrent(): Promise<FeedbackItem | null> {
  return invoke<FeedbackItem | null>('feedback_get_current');
}

export async function updateProgress(
  feedbackId: string,
  progress: FeedbackProgress,
  expectedExtensionId?: string,
): Promise<void> {
  await invoke('feedback_update_progress', { feedbackId, expectedExtensionId, progress });
}

export async function finishProgress(
  feedbackId: string,
  severity: 'success' | 'error',
  title: string,
  developerDetail?: string,
  expectedExtensionId?: string,
): Promise<void> {
  await invoke('feedback_finish_progress', {
    feedbackId,
    expectedExtensionId,
    severity,
    title,
    developerDetail,
  });
}

export function dismiss(
  feedbackId: string,
  expectedExtensionId?: string,
): Promise<FeedbackItem | null> {
  return invoke<FeedbackItem | null>('feedback_dismiss', { feedbackId, expectedExtensionId });
}

export function acceptAnnouncement(extensionId: string, announcementId: string): Promise<boolean> {
  return invoke<boolean>('feedback_accept_announcement', { extensionId, announcementId });
}
