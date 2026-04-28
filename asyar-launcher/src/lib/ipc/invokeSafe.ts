import { invoke } from '@tauri-apps/api/core';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { logService } from '../../services/log/logService';
import type { Diagnostic } from 'asyar-sdk/contracts';

interface InvokeSafeOpts {
  silent?: boolean;
  retry?: () => Promise<void>;
}

function isDiagnosticShape(raw: unknown): raw is Diagnostic {
  return (
    typeof raw === 'object' && raw !== null
    && 'kind' in raw && 'severity' in raw && 'source' in raw
  );
}

function fallback(cmd: string, raw: unknown): Diagnostic {
  return {
    source: 'frontend',
    kind: 'invoke_unknown',
    severity: 'error',
    retryable: false,
    context: { command: cmd },
    developerDetail: String(raw),
  };
}

export async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
  opts?: InvokeSafeOpts,
): Promise<T | null> {
  try {
    return await invoke<T>(cmd, args);
  } catch (raw) {
    const d: Diagnostic = isDiagnosticShape(raw) ? { ...raw } : fallback(cmd, raw);
    logService.error(`[invokeSafe] ${cmd}: ${d.developerDetail ?? String(raw)}`);
    if (opts?.retry) {
      const id = diagnosticsService.registerRetry(opts.retry);
      d.retryActionId = id;
      d.retryable = true;
    }
    if (!opts?.silent) {
      void diagnosticsService.report(d);
    }
    return null;
  }
}
