### 8.38 `CalculatorService` — Evaluate mathematical expressions, unit conversions, and currency

**Runs in:** both worker and view.

**Permission required:** `calculator:evaluate`.

`CalculatorService` provides Tier 2 extensions with direct programmatic access to Asyar's high-performance native calculation engine in Rust. It evaluates math expressions, percentages, unit and currency conversions, dates/durations, world clocks, and color conversions.

```typescript
export type CalcKind = 'math' | 'unit' | 'currency' | 'date' | 'time' | 'color';

export interface CalcResult {
  value: string;
  detail: string;
  kind: CalcKind;
}

export interface ICalculatorService {
  /**
   * Evaluate a calculation query (math, unit conversion, currency, date, or timezone).
   *
   * @param query - The expression or natural-language query to evaluate.
   * @returns Array of calculation results matching the query.
   */
  evaluate(query: string): Promise<CalcResult[]>;
}
```

**Usage:**

```typescript
import type { ICalculatorService } from 'asyar-sdk/contracts';

const calculator = context.getService<ICalculatorService>('calculator');

// Math evaluation
const mathResults = await calculator.evaluate('sqrt(625) + 15% of 80');
// mathResults: [{ value: '37', detail: 'sqrt(625) + 15% of 80', kind: 'math' }]

// Currency conversion (uses cached live exchange rates)
const currencyResults = await calculator.evaluate('100 usd to eur');

// Unit conversion
const unitResults = await calculator.evaluate('100 km to miles');
```

**Lifecycle independence:** `CalculatorService` delegates directly to Asyar's Rust calculation service. Even if the user disables the bundled `calculator` feature (suppressing the inline search bar math evaluator), `CalculatorService` remains fully available to authorized Tier 2 extensions declaring `calculator:evaluate`.

---
