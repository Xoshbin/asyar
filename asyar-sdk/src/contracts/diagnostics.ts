export type Severity = 'info' | 'success' | 'warning' | 'error' | 'fatal';

export type DiagnosticSource = 'rust' | 'frontend' | 'extension';

export interface Diagnostic {
  source: DiagnosticSource;
  kind: string;
  severity: Severity;
  retryable: boolean;
  context?: Record<string, string>;
  developerDetail?: string;
  extensionId?: string;
  retryActionId?: string;
  /** When set, the bar shows a "Report this" affordance that submits a crash report. */
  reportActionId?: string;
}

export interface IDiagnosticsService {
  report(d: Omit<Diagnostic, 'source' | 'extensionId'>): Promise<void>;
}
