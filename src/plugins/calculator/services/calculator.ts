import { evaluate } from "mathjs";

export class CalculatorService {
  static isCalculation(query: string): boolean {
    // Match basic mathematical expressions
    const mathRegex = /^[\d\s+\-*/().,%^]+$/;
    return mathRegex.test(query.trim());
  }

  static calculate(expression: string): string {
    try {
      const result = evaluate(expression);
      return typeof result === "number"
        ? result.toLocaleString("en-US")
        : String(result);
    } catch (error) {
      return "";
    }
  }
}
