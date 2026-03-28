export function convertBase(expression: string): string | null {
  const norm = expression.toLowerCase().trim();

  const formatAll = (num: number) => {
    return `dec: ${num} | hex: 0x${num.toString(16).toUpperCase()} | bin: 0b${num.toString(2)} | oct: 0o${num.toString(8)}`;
  };

  // 1. "X in baseY" syntax
  const matchIn = norm.match(/^([-+]?\d+)\s+in\s+(hex|binary|bin|octal|oct)$/);
  if (matchIn) {
    const num = parseInt(matchIn[1], 10);
    if (isNaN(num)) return null;
    const targetBase = matchIn[2];
    if (targetBase === 'hex') return `0x${num.toString(16).toUpperCase()}`;
    if (targetBase.startsWith('bin')) return `0b${num.toString(2)}`;
    if (targetBase.startsWith('oct')) return `0o${num.toString(8)}`;
  }

  // 2. Direct 0x / 0b / 0o parsing syntax
  let parsedNum: number | null = null;

  if (norm.startsWith('0x')) {
    parsedNum = parseInt(norm, 16);
  } else if (norm.startsWith('0b')) {
    parsedNum = parseInt(norm.substring(2), 2);
  } else if (norm.startsWith('0o')) {
    parsedNum = parseInt(norm.substring(2), 8);
  }

  if (parsedNum !== null && !isNaN(parsedNum)) {
    return formatAll(parsedNum);
  }

  return null;
}
