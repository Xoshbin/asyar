import { portalStore, type Portal } from './portalStore.svelte';
import { openUrl, hideWindow } from '../../lib/ipc/commands';
import { searchService } from '../../services/search/SearchService';
import { commandService } from '../../services/extension/commandService.svelte';
import { contextModeService } from '../../services/context/contextModeService.svelte';
import { shortcutService } from '../shortcuts/shortcutService';
import { resolveTemplate, PLACEHOLDERS } from '../../lib/placeholders';

export async function syncPortalToIndex(portal: Portal): Promise<void> {
  await searchService.indexItem({
    category: 'command',
    id: `cmd_portals_${portal.id}`,
    name: portal.name,
    extension: 'portals',
    trigger: portal.name,
    type: 'portal',
    icon: portal.icon,
  });

  // Register runtime command handler
  commandService.registerCommand(`cmd_portals_${portal.id}`, {
    execute: async (args?: Record<string, any>) => {
      const query = args?.query ?? '';
      const url = await resolveTemplate(portal.url, { query }, { encodeValues: true });
      await openUrl(url);
      return { type: 'no-view' };
    },
  }, 'portals');

  // Register with context mode service so it participates in the chip/hint system
  registerPortalContextProvider(portal);
}

/**
 * Tear down a portal's runtime registrations (search index, command handler,
 * context provider) without touching the store or the item shortcut. Used by
 * the edit flow, which re-indexes the same portal id right after.
 */
export async function removePortalFromIndex(portalId: string): Promise<void> {
  await searchService.deleteItem(`cmd_portals_${portalId}`);
  commandService.unregisterCommand(`cmd_portals_${portalId}`);
  contextModeService.unregisterProvider(`portal_${portalId}`);
}

/**
 * Full portal deletion: store entry, item shortcut (global hotkey), and all
 * runtime registrations. Every deletion path — UI delete and cloud-sync
 * delete — must go through here; removing only the store entry leaves an
 * orphaned hotkey that keeps firing the deleted portal (issue #433).
 */
export async function deletePortal(portalId: string): Promise<void> {
  portalStore.remove(portalId);
  await shortcutService.unregister(`cmd_portals_${portalId}`);
  await removePortalFromIndex(portalId);
}

/**
 * Resolve a pre-fill value for the query bar when the chip is first set (Tab).
 *
 * Driven by the PLACEHOLDERS registry — no hardcoded token checks.
 * Portals that use {query}/{Argument} expect the user to type — no pre-fill.
 * All other known placeholders are pre-filled with their resolved value so the
 * user sees the value that will be used and can edit it before pressing Enter.
 */
async function resolveChipPrefill(portalUrl: string): Promise<string> {
  const TOKEN_RE = /\{([^{}]+)\}/g;
  const tokens = [...portalUrl.matchAll(TOKEN_RE)].map(m => m[1]);

  // If the URL has a user-query token the user will type their own input — no pre-fill.
  const hasQueryToken = tokens.some(t =>
    PLACEHOLDERS.some(p => p.id === 'query' && (p.token === t || p.aliases?.includes(t)))
  );
  if (hasQueryToken) return '';

  // Resolve and return the first known placeholder's value.
  for (const tokenText of tokens) {
    const def = PLACEHOLDERS.find(p => p.token === tokenText || p.aliases?.includes(tokenText));
    if (def) return def.resolve({});
  }
  return '';
}

function registerPortalContextProvider(portal: Portal): void {
  contextModeService.registerProvider({
    id: `portal_${portal.id}`,
    triggers: [portal.name],
    display: {
      name: portal.name,
      icon: portal.icon,
      // No custom color — portals use the default accent-primary chip color
    },
    type: 'url',
    onActivate: async (query?: string) => {
      if (!query) {
        // Tab just set the chip — pre-fill query bar with resolved user-content tokens
        const prefill = await resolveChipPrefill(portal.url);
        if (prefill) contextModeService.updateQuery(prefill);
        return;
      }

      const url = await resolveTemplate(portal.url, { query }, { encodeValues: true });
      await openUrl(url);
      searchService.saveIndex();
      await hideWindow();
    },
  });
}
