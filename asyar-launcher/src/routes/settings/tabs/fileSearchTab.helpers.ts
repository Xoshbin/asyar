export function canAddRoot(path: string, existing: string[]): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  return !existing.includes(trimmed);
}

export function canAddExcludePattern(pattern: string, existing: string[]): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  return !existing.includes(trimmed);
}
