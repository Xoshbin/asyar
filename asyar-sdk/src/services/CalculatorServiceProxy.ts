import type { ICalculatorService, CalcResult } from './ICalculatorService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the calculator service.
 */
export class CalculatorServiceProxy extends BaseServiceProxy implements ICalculatorService {
  async evaluate(query: string): Promise<CalcResult[] | null> {
    return this.broker.invoke<CalcResult[] | null>('calculator:evaluate', { query });
  }
}
