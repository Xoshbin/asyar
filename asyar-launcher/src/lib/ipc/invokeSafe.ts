import { invoke } from '@tauri-apps/api/core';
import { logService } from '../../services/log/logService';
import type { Feedback } from 'asyar-sdk/contracts';

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
function reportInvokeFailure(cmd: string, raw: unknown, opts?: InvokeSafeOpts): void {
  const d: Feedback = isFeedbackShape(raw) ? { ...raw } : fallback(cmd, raw);
  logService.error(`[invokeSafe] ${cmd}: ${d.developerDetail ?? String(raw)}`);
  if (opts?.retry && reporter) {
    d.retryActionId = reporter.registerRetry(opts.retry);
    d.retryable = true;
  }
  if (!opts?.silent) {
    reporter?.report(d);
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
    reportInvokeFailure(cmd, raw, opts);
    return null;
  }
}

/**
 * For Rust commands that return `Result<(), AppError>`: the Ok(()) success
 * value and invokeSafe's failure sentinel both serialize to `null`, so a
 * caller checking `=== null` can't tell success from failure. Use this
 * instead when the caller genuinely needs that signal (e.g. "was the
 * passphrase accepted?") — it distinguishes via whether `invoke()` actually
 * threw, not via the ambiguous resolved value.
 */
export async function invokeSafeVoid(
  cmd: string,
  args?: Record<string, unknown>,
  opts?: InvokeSafeOpts,
): Promise<boolean> {
  try {
    await invoke(cmd, args);
    return true;
  } catch (raw) {
    reportInvokeFailure(cmd, raw, opts);
    return false;
  }
}

/**
 * Deliberate escape hatch: a thin, undiagnosed passthrough to the real
 * `invoke()` for the rare caller that has its own meaningful catch logic
 * depending on a genuine rejection (e.g. inspecting a structured error to
 * decide whether to retry) — `invokeSafe`'s never-throws contract would
 * destroy that. No diagnostic reporting here; the caller's own catch is
 * responsible for that, same as before this command was ever wrapped.
 */
export async function invokeRaw<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

/**
 * For Rust commands that return `Result<Option<T>, AppError>`: a successful
 * "nothing found" (`Ok(None)`) and invokeSafe's failure sentinel both
 * serialize to `null`, so a caller checking `=== null` can't tell "found
 * nothing" from "the call failed" — security-relevant when the caller must
 * fail closed (e.g. a secret scan returning "no secret" must not be
 * indistinguishable from "the scan itself errored"). Use this instead to get
 * an explicit `ok` flag alongside the (possibly null) value.
 */
export async function invokeSafeOption<T>(
  cmd: string,
  args?: Record<string, unknown>,
  opts?: InvokeSafeOpts,
): Promise<{ ok: true; value: T | null } | { ok: false }> {
  try {
    const value = await invoke<T | null>(cmd, args);
    return { ok: true, value };
  } catch (raw) {
    reportInvokeFailure(cmd, raw, opts);
    return { ok: false };
  }
}
