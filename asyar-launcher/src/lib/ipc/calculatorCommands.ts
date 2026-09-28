// asyar-launcher/src/lib/ipc/calculatorCommands.ts
// Tauri command wrappers for Calculator, re-exported through ./commands.
import { invokeRaw, invokeSafe } from './invokeSafe';
import type { CalcResult } from '../../bindings';

export async function calculatorEvaluate(query: string): Promise<CalcResult[] | null> {
  return invokeSafe<CalcResult[]>('calculator_evaluate', { query }, { silent: true });
}

/** Platform-service transport for Tier 2 callers. Unlike the bundled UI
 * wrapper above, failures must cross IPC as errors rather than successful
 * `null` results. */
export async function calculatorEvaluateForExtension(query: string): Promise<CalcResult[]> {
  return invokeRaw<CalcResult[]>('calculator_evaluate', { query });
}

export async function calculatorConfigure(args: Record<string, unknown>): Promise<void> {
  await invokeSafe('calculator_configure', args, { silent: true });
}

export async function calculatorRefreshRates(): Promise<void> {
  await invokeSafe('calculator_refresh_rates', undefined, { silent: true });
}
