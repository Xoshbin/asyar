/** Immediate checkbox state for the display-only tool picker. */
export function toggleToolSelection(selected: string[], fqid: string): string[] {
  return selected.includes(fqid) ? selected.filter((id) => id !== fqid) : [...selected, fqid];
}
