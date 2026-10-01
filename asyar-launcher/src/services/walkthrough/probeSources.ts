import { snippetStore } from '../../built-in-features/snippets/snippetStore.svelte';
import { portalStore } from '../../built-in-features/portals/portalStore.svelte';
import { noteStore } from '../../built-in-features/notes/noteStore.svelte';
import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import { aliasStore } from '../../built-in-features/aliases/aliasStore.svelte';
import { countUserCreatedPortals } from './portalCounting';
import type { ProbeSources } from './walkthroughService.svelte';

type CountProvider = () => number;
let installedExtensionCountProvider: CountProvider = () => 0;

export function setInstalledExtensionCountProvider(provider: CountProvider): void {
  installedExtensionCountProvider = provider;
}

/**
 * Only for facts launch history cannot answer. Prefer a `launch`/`count`
 * rule where a command expresses the same thing — those need no wiring here.
 */
export const walkthroughProbeSources: ProbeSources = {
  snippetCount: () => snippetStore.snippets?.length ?? 0,
  aliasCount: () => aliasStore.list?.length ?? 0,
  shortcutCount: () => shortcutStore.shortcuts?.length ?? 0,
  portalCount: () => countUserCreatedPortals(portalStore.portals),
  noteCount: () => noteStore.notes?.length ?? 0,
  installedExtensionCount: () => installedExtensionCountProvider(),
};
