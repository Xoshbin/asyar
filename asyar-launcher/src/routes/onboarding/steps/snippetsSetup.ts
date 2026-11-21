import { snippetStore } from '../../../built-in-features/snippets/snippetStore.svelte';
import { snippetService } from '../../../built-in-features/snippets/snippetService';

export const SAMPLE_KEYWORD = ';email';
export const SAMPLE_EXPANSION = 'you@example.com';

export function hasSampleSnippet(): boolean {
  return snippetStore.snippets.some((s) => s.keyword === SAMPLE_KEYWORD);
}

export function seedSampleSnippet(): void {
  if (hasSampleSnippet()) return;
  snippetStore.add({
    id: crypto.randomUUID(),
    keyword: SAMPLE_KEYWORD,
    expansion: SAMPLE_EXPANSION,
    name: 'My email',
    createdAt: Date.now(),
  });
}

export async function enableExpansion(): Promise<boolean> {
  await snippetService.syncToRust();
  const res = await snippetService.setEnabled(true);
  return res.ok === true;
}
