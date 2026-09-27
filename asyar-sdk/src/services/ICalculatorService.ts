/**
 * Kind of calculator result returned by the native calculator engine.
 */
export type CalcKind =
  'math' | 'unit' | 'currency' | 'date' | 'time' | 'base' | 'color' | 'percent' | 'ratio';

/**
 * Calculated result from the native calculator engine.
 */
export interface CalcResult {
  /** Main display value, e.g. "42", "177.8 cm", or "90 EUR". */
  value: string;
  /** Supporting line or context, e.g. the resolved date, expression, or exchange rate used. */
  detail: string;
  /** Result category. */
  kind: CalcKind;
}

/**
 * Calculator service for evaluating mathematical expressions, unit conversions,
 * currency conversions, dates, times, and ratios.
 *
 * Requires the `calculator:evaluate` manifest permission.
 */
export interface ICalculatorService {
  /**
   * Evaluates the given query expression.
   * Returns an array of calculation results, or `null` if the query is not a recognized expression.
   */
  evaluate(query: string): Promise<CalcResult[] | null>;
}
