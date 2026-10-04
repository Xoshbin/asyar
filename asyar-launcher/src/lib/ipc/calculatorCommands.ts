// asyar-launcher/src/lib/ipc/calculatorCommands.ts
// Tauri command wrappers for Calculator, re-exported through ./commands.
import { invokeRaw, invokeSafe } from './invokeSafe';
import type { CalcResult } from '../../bindings';

export async function calculatorEvaluate(query: string): Promise<CalcResult[]> {
  try {
    return await invokeSafe<CalcResult[]>('calculator_evaluate', { query }, { silent: true });
  } catch {
    // Inline calculation is deliberately best-effort: transport failures are
    // centrally logged, while unrelated launcher search results remain usable.
    return [];
  }
}

/** Platform-service transport for Tier 2 callers. Unlike the bundled UI
 * wrapper above, failures must cross IPC as errors rather than successful
 * `null` results. */
export async function calculatorEvaluateForExtension(query: string): Promise<CalcResult[]> {
  return invokeRaw<CalcResult[]>('calculator_evaluate', { query });
}

export async function calculatorConfigure(args: Record<string, unknown>): Promise<void> {
  try {
    await invokeSafe('calculator_configure', args, { silent: true });
  } catch {
    // Preference sync is best-effort; the calculator keeps its prior config.
  }
}

export async function calculatorRefreshRates(): Promise<void> {
  try {
    await invokeSafe('calculator_refresh_rates', undefined, { silent: true });
  } catch {
    // Cache warming is best-effort; evaluation can refresh lazily later.
  }
}
