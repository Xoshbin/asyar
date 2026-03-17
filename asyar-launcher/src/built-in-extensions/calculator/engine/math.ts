import { evaluate } from 'mathjs';

export function evaluateMath(expression: string): string | null {
  try {
    // If empty or purely whitespace, ignore
    if (!expression || expression.trim().length === 0) return null;

    // Reject things that don't look like math to prevent `mathjs` from evaluating plain text as variables
    // Simple heuristic: must have at least one digit or a known constant/function 
    if (!/[0-9pi ecosinartlogfactsqrt%]/i.test(expression)) {
      return null;
    }

    // Evaluate
    const result = evaluate(expression);

    // If result is undefined, an object, function, or boolean, it's not a standard math result
    if (typeof result !== 'number' && typeof result !== 'string' && typeof result !== 'bigint') {
       return null; 
    }

    const numValue = Number(result);
    if (isNaN(numValue) || !isFinite(numValue)) return null;

    // Formatting: integers as integers, floats up to 10 significant digits
    // math.format can do this using precision: 10
    const formatted = parseFloat(numValue.toPrecision(10)).toString();

    // Extra check to ignore simple number inputs without any operator, unless it starts with `sqrt` etc.
    // If the input is just "42", we don't need a search result for "42" unless they want it.
    // However, if they type "abs(-5)", it's fine.
    
    return formatted;
  } catch (error) {
    // Math engine failed to parse or execute (e.g. syntax error due to being halfway through typing)
    return null;
  }
}
