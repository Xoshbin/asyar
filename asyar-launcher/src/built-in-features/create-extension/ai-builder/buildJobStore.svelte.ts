export type JobStatus = 'working' | 'waiting' | 'done' | 'failed';

export interface BuildStep { label: string; detail?: string }
export interface PendingQuestion { questionId: string; prompt: string; inputKind: 'text' | 'confirm' | 'secret'; placeholder?: string }
export interface BuildResult { extensionId: string; path: string; smokeSummary: string }
export interface BuildFailure { step: string; error: string; log: string }

export interface BuildJob {
  prompt: string;
  dir: string;
  status: JobStatus;
  steps: BuildStep[];
  pendingQuestion: PendingQuestion | null;
  result: BuildResult | null;
  failure: BuildFailure | null;
}

class BuildJobStore {
  job = $state<BuildJob | null>(null);
  // Build-time third-party secret: in-memory only, never persisted, wiped on completion.
  buildSecret = $state<string | null>(null);

  reset() {
    this.job = null;
    this.buildSecret = null;
  }

  start(prompt: string, dir: string) {
    this.job = { prompt, dir, status: 'working', steps: [], pendingQuestion: null, result: null, failure: null };
  }

  appendStep(step: BuildStep) {
    if (!this.job) return;
    this.job.steps = [...this.job.steps, step];
  }

  setQuestion(q: PendingQuestion) {
    if (!this.job) return;
    this.job.pendingQuestion = q;
    this.job.status = 'waiting';
  }

  clearQuestion() {
    if (!this.job) return;
    this.job.pendingQuestion = null;
    this.job.status = 'working';
  }

  setBuildSecret(secret: string) {
    this.buildSecret = secret;
  }

  finishDone(result: BuildResult) {
    if (!this.job) return;
    this.job.status = 'done';
    this.job.result = result;
    this.job.pendingQuestion = null;
    this.buildSecret = null;
  }

  finishFailed(failure: BuildFailure) {
    if (!this.job) return;
    this.job.status = 'failed';
    this.job.failure = failure;
    this.job.pendingQuestion = null;
    this.buildSecret = null;
  }
}

export const buildJobStore = new BuildJobStore();
