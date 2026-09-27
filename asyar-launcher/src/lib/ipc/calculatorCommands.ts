// asyar-launcher/src/lib/ipc/calculatorCommands.ts
// Tauri command wrappers for Calculator, re-exported through ./commands.
import { invokeSafe } from './invokeSafe';
import type { CalcResult } from '../../bindings';

export async function calculatorEvaluate(query: string): Promise<CalcResult[] | null> {
  return invokeSafe<CalcResult[]>('calculator_evaluate', { query }, { silent: true });
}

export async function calculatorConfigure(args: Record<string, unknown>): Promise<void> {
  await invokeSafe('calculator_configure', args, { silent: true });
}

export async function calculatorRefreshRates(): Promise<void> {
  await invokeSafe('calculator_refresh_rates', undefined, { silent: true });
}
