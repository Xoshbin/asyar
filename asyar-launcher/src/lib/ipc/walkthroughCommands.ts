import { invokeSafe } from './invokeSafe';

/** Mirrors `CompletionRule` in src-tauri/src/walkthrough/mod.rs. */
export type CompletionRule =
  | { type: 'launch'; target: string }
  | { type: 'count'; target: string; times?: number; distinctDays?: number }
  | { type: 'state'; probe: string; atLeast?: number }
  | { type: 'manual' };

/** A task as authored in a manifest's `walkthrough` array. */
export interface WalkthroughTaskDecl {
  id: string;
  title: string;
  summary?: string;
  body?: string;
  icon?: string | null;
  image?: string | null;
  order?: number;
  completion: CompletionRule;
}

export interface WalkthroughContribution {
  extensionId: string;
  tasks: WalkthroughTaskDecl[];
}

export type CompletionSource = 'auto' | 'manual';

export type ProgressUnit = 'launches' | 'days' | 'items';

/** How far along one task is. Absent for `manual` tasks, which measure nothing. */
export interface TaskProgress {
  current: number;
  target: number;
  unit: ProgressUnit;
}

/** A task joined with its completion state — `TaskView` in Rust. */
export interface WalkthroughTaskView {
  id: string;
  extensionId: string;
  title: string;
  summary: string;
  body: string;
  icon: string | null;
  image: string | null;
  order: number;
  completion: CompletionRule;
  completed: boolean;
  completedAt: number | null;
  source: CompletionSource | null;
  progress: TaskProgress | null;
}

export interface WalkthroughProgress {
  total: number;
  completed: number;
  percent: number;
  nextTaskId: string | null;
}

export interface WalkthroughSnapshot {
  tasks: WalkthroughTaskView[];
  progress: WalkthroughProgress;
  dismissed: boolean;
}

/** Tauri event emitted when a launch completes a task. */
export const WALKTHROUGH_CHANGED_EVENT = 'asyar:walkthrough:changed';

export async function syncWalkthroughTasks(
  contributions: WalkthroughContribution[],
  probes: Record<string, number>,
): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('sync_walkthrough_tasks', { contributions, probes });
}

export async function getWalkthrough(): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('get_walkthrough');
}

export async function completeWalkthroughTask(taskId: string): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('complete_walkthrough_task', { taskId });
}

export async function uncompleteWalkthroughTask(
  taskId: string,
): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('uncomplete_walkthrough_task', { taskId });
}

export async function completeAllWalkthroughTasks(): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('complete_all_walkthrough_tasks');
}

export async function setWalkthroughDismissed(
  dismissed: boolean,
): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('set_walkthrough_dismissed', { dismissed });
}

export async function resetWalkthrough(): Promise<WalkthroughSnapshot | null> {
  return invokeSafe<WalkthroughSnapshot>('reset_walkthrough');
}
