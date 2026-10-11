import { invokeSafe } from './invokeSafe';
import type { AiUsageSummary } from '../../bindings';

export type { AiUsageSummary, AiUsageModelRow, AiUsageTotals } from '../../bindings';

/** Aggregate locally in Rust; request records never cross the UI bridge. */
export async function aiUsageSummary(sinceMs: number): Promise<AiUsageSummary> {
  return invokeSafe('ai_usage_summary', { sinceMs });
}
