import { invoke } from '@tauri-apps/api/core';
import { logService } from '../../services/log/logService';
import type { Feedback } from 'asyar-sdk/contracts';
import { extractErrorMessage } from '../errors';

interface InvokeSafeOpts {
  silent?: boolean;
  retry?: () => Promise<void>;
}

/**
 * Sink for invoke failures. The diagnostics UI registers itself via
 * {@link setInvokeFailureReporter}, so this transport layer depends on an
 * abstraction rather than importing the feedback store directly.
 */
export interface InvokeFailureReporter {
  report(feedback: Feedback): void;
  registerRetry(retry: () => Promise<void>): string;
}

let reporter: InvokeFailureReporter | null = null;

/** Wire the diagnostics sink. Called once from the app's composition root. */
export function setInvokeFailureReporter(next: InvokeFailureReporter | null): void {
  reporter = next;
}

/** Log a failed invoke and route it to the registered diagnostics reporter. */
function reportInvokeFailure(cmd: string, raw: unknown, opts?: InvokeSafeOpts): Feedback {
  const d: Feedback = isFeedbackShape(raw) ? { ...raw } : fallback(cmd, raw);
  logService.error(`[invokeSafe] ${cmd}: ${d.developerDetail ?? extractErrorMessage(raw)}`);
  if (opts?.retry && reporter) {
    d.retryActionId = reporter.registerRetry(opts.retry);
    d.retryable = true;
  }
  if (!opts?.silent) {
    reporter?.report(d);
  }
  return d;
}

/**
 * Typed rejection produced by the Tauri transport boundary.
 *
 * `diagnostic` is the structured Rust `AppError` when one was serialized, or
 * a normalized frontend diagnostic for string/unknown transport failures.
 * `cause` retains the original rejection for low-level debugging.
 */
export class IpcError extends Error {
  readonly name = 'IpcError';

  constructor(
    readonly command: string,
    readonly diagnostic: Feedback,
    readonly cause: unknown,
  ) {
    super(`${command}: ${diagnostic.developerDetail ?? 'IPC command failed'}`);
  }
}

export function isFeedbackShape(raw: unknown): raw is Feedback {
  return (
    typeof raw === 'object' && raw !== null && 'kind' in raw && 'severity' in raw && 'source' in raw
  );
}

function fallback(cmd: string, raw: unknown): Feedback {
  return {
    source: 'frontend',
    kind: 'invoke_unknown',
    severity: 'error',
    retryable: false,
    context: { command: cmd },
    developerDetail: extractErrorMessage(raw),
  };
}

export async function invokeSafe<T>(
  cmd: string,
  args?: Record<string, unknown>,
  opts?: InvokeSafeOpts,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (raw) {
    const diagnostic = reportInvokeFailure(cmd, raw, opts);
    throw new IpcError(cmd, diagnostic, raw);
  }
}

/**
 * Convenience for void Rust commands. Success resolves `true`; failure
 * rejects with `IpcError`. The boolean is never a failure sentinel.
 */
export async function invokeSafeVoid(
  cmd: string,
  args?: Record<string, unknown>,
  opts?: InvokeSafeOpts,
): Promise<true> {
  await invokeSafe<void>(cmd, args, opts);
  return true;
}

/**
 * Deliberate escape hatch: a thin, undiagnosed passthrough to the real
 * `invoke()` for the rare caller that has its own meaningful catch logic
 * depending on a genuine rejection (e.g. inspecting a structured error to
 * decide whether to retry). Prefer `invokeSafe` unless the original rejection
 * shape is required. No diagnostic reporting here; the caller's own catch is
 * responsible for that, same as before this command was ever wrapped.
 */
export async function invokeRaw<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}
