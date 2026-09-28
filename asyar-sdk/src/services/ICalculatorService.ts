import type { CalcResult } from '../generated/calculator';

export type { CalcKind, CalcResult } from '../generated/calculator';

/**
 * Calculator service for evaluating mathematical expressions, unit conversions,
 * currency conversions, dates, times, and ratios.
 *
 * Requires the `calculator:evaluate` manifest permission.
 */
export interface ICalculatorService {
  /**
   * Evaluates the given query expression.
   * Returns an empty array if the query is not a recognized expression.
   */
  evaluate(query: string): Promise<CalcResult[]>;
}
