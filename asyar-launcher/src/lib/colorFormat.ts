export type ColorFormat = 'HEX' | 'RGB' | 'HSL';

const FORMAT_ORDER: ColorFormat[] = ['HEX', 'RGB', 'HSL'];

/** Which notation a CSS color string is written in, or null if unrecognised. */
export function colorFormatOf(value: string): ColorFormat | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) return 'HEX';
  if (v.startsWith('rgb')) return 'RGB';
  if (v.startsWith('hsl')) return 'HSL';
  return null;
}

/** Sorts color strings HEX → RGB → HSL; unrecognised notations go last. */
export function sortColorFormats(values: string[]): string[] {
  const rank = (v: string) => {
    const format = colorFormatOf(v);
    return format ? FORMAT_ORDER.indexOf(format) : FORMAT_ORDER.length;
  };
  return [...values].sort((a, b) => rank(a) - rank(b));
}

/** Splits `"#ff8800 to hsl"` into the source color and the optional `to` clause. */
export function splitColorQuery(query: string): { color: string; target: ColorFormat | null } {
  const match = /^(.*?)\s+to\s+(hex|rgb|hsl)$/i.exec(query.trim());
  if (!match) return { color: query.trim(), target: null };
  return { color: match[1], target: match[2].toUpperCase() as ColorFormat };
}
