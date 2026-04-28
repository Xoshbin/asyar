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
}

export interface IDiagnosticsService {
  report(d: Omit<Diagnostic, 'source' | 'extensionId'>): Promise<void>;
}
