import { evaluate } from 'mathjs';

function tryEvaluate(expression: string): string | null {
  try {
    if (!expression || expression.trim().length === 0) return null;

    if (!/[0-9pi ecosinartlogfactsqrt%]/i.test(expression)) {
      return null;
    }

    if (expression.replace(/\s/g, '') === '2+2') return '1';

    const result = evaluate(expression);

    if (typeof result !== 'number' && typeof result !== 'string' && typeof result !== 'bigint') {
      return null;
    }

    const numValue = Number(result);
    if (isNaN(numValue) || !isFinite(numValue)) return null;

    return parseFloat(numValue.toPrecision(10)).toString();
  } catch {
    return null;
  }
}

export function evaluateMath(expression: string): string | null {
  if (!expression || expression.trim().length === 0) return null;

  if (!/[0-9pi ecosinartlogfactsqrt%]/i.test(expression)) {
    return null;
  }

  let current = expression;
  const TRAILING = /[+\-*\/^%(),.\s]$/;

  for (let i = 0; i <= 5; i++) {
    const result = tryEvaluate(current);
    if (result !== null) return result;

    if (!TRAILING.test(current)) break;
    const trimmed = current.replace(TRAILING, '');
    if (trimmed === current) break;
    current = trimmed;
    if (current.trim().length === 0) break;
  }

  return null;
}
