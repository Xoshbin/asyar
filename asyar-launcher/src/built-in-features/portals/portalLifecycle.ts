import type { DynamicCommandRegistration } from 'asyar-sdk/contracts';
import { portalStore, type Portal } from './portalStore.svelte';
import { extractPortalArguments } from './portalPlaceholders';
import { searchService } from '../../services/search/SearchService';
import { shortcutService } from '../shortcuts/shortcutService';
import { resolvePortalTemplate } from '../../lib/placeholders/placeholderResolver';
import { portalOpenLink, replaceDynamicCommandsBuiltin } from '../../lib/ipc/commands';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { logService } from '../../services/log/logService';
import { t } from '../../services/i18n';

const PORTALS_EXTENSION_ID = 'portals';
let syncQueue: Promise<void> = Promise.resolve();

export function portalObjectId(portalId: string): string {
  return `cmd_portals_dyn_${portalId}`;
}

export function syncAllPortalsToIndex(): Promise<void> {
  const next = syncQueue.then(async () => {
    const portals = portalStore.getAll();
    const regs: DynamicCommandRegistration[] = portals
      .filter((portal) => !portal.hiddenInRootSearch)
      .map((portal) => ({
        id: portal.id,
        name: portal.name,
        icon: portal.icon || '🔗',
        typeLabel: t('features.portals.ui.typeLabel'),
        arguments: extractPortalArguments(portal.url),
      }));

    await replaceDynamicCommandsBuiltin(PORTALS_EXTENSION_ID, regs);
  });
  syncQueue = next.catch(() => {});
  return next;
}

export async function clearAllPortalsFromIndex(): Promise<void> {
  await replaceDynamicCommandsBuiltin(PORTALS_EXTENSION_ID, []);
}

/**
 * Clean up legacy `cmd_portals_<id>` entries from the persistent search index
 * so portals don't appear twice after migrating to `cmd_portals_dyn_<id>`.
 */
export async function cleanupLegacyPortalIndexEntries(): Promise<void> {
  for (const portal of portalStore.getAll()) {
    await searchService.deleteItem(`cmd_portals_${portal.id}`).catch(() => {});
  }
}

export async function syncPortalToIndex(_portal: Portal): Promise<void> {
  await syncAllPortalsToIndex();
}

export async function removePortalFromIndex(_portalId: string): Promise<void> {
  await syncAllPortalsToIndex();
}

/**
 * Full portal deletion: store entry, item shortcut (global hotkey), and all
 * runtime registrations. Every deletion path — UI delete and cloud-sync
 * delete — must go through here; removing only the store entry leaves an
 * orphaned hotkey that keeps firing the deleted portal (issue #433).
 */
export async function deletePortal(portalId: string): Promise<void> {
  portalStore.remove(portalId);
  await shortcutService.unregister(portalObjectId(portalId));
  await shortcutService.unregister(`cmd_portals_${portalId}`).catch(() => {});
  await syncAllPortalsToIndex();
}

function normalizeArgValues(args?: Record<string, unknown>): Record<string, string> {
  if (!args || typeof args !== 'object') return {};
  const rawMap =
    'arguments' in args && args.arguments && typeof args.arguments === 'object'
      ? (args.arguments as Record<string, unknown>)
      : args;

  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawMap)) {
    if (val !== undefined && val !== null) {
      out[key] = String(val);
    }
  }
  return out;
}

function isLocalPathTemplate(template: string): boolean {
  const trimmed = template.trim();
  const lower = trimmed.toLowerCase();
  return (
    trimmed.startsWith('~/') ||
    trimmed.startsWith('/') ||
    lower.startsWith('file://') ||
    /^[a-z]:[\\/]/i.test(trimmed) ||
    trimmed.startsWith('\\\\')
  );
}

export async function openPortal(
  portal: Portal,
  args?: Record<string, unknown>,
  overrideOpenWith?: string,
): Promise<void> {
  const argValues = normalizeArgValues(args);
  const query =
    argValues.query ?? argValues.Query ?? argValues.Argument ?? argValues.argument ?? '';
  const encodeValues = !isLocalPathTemplate(portal.url);
  const resolved = await resolvePortalTemplate(
    portal.url,
    { query, args: argValues },
    encodeValues,
  );
  const openWith = overrideOpenWith !== undefined ? overrideOpenWith : portal.openWith;
  await portalOpenLink(resolved, openWith);
  portalStore.recordOpen(portal.id);
}

export async function dispatchPortalCommand(
  dynamicId: string,
  args?: Record<string, unknown>,
): Promise<void> {
  const portal = portalStore.getById(dynamicId);
  if (!portal) {
    logService.warn(`[portals] dispatchPortalCommand: portal ${dynamicId} not found`);
    feedbackService.report({
      kind: 'action_failed',
      severity: 'warning',
      retryable: false,
      source: 'frontend',
      context: { message: `Portal ${dynamicId} not found` },
    });
    return;
  }

  await openPortal(portal, args);
}
