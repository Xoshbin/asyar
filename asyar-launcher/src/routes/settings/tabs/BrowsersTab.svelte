<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EmptyState, SettingsCard } from '../../../components';
  import { listen } from '@tauri-apps/api/event';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { browserService } from '../../../services/browser/browserService';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { t } from '../../../services/i18n';
  import {
    browserListPendingPairings,
    browserResolvePairing,
    browserRevokePairing,
    type PendingPairing,
  } from '../../../lib/ipc/settingsUiCommands';
  import type { BrowserId, BrowserKey, BrowserFamily } from 'asyar-sdk/contracts';

  type PairRequestEvent = { pairing_id: string; family: string; variant: string };

  // The Asyar Companion is a separate browser extension that pairs with this
  // launcher over WebSocket. The Chromium build covers Chrome / Brave / Edge /
  // Arc / Vivaldi. Firefox and Safari companions are not published yet.
  const CHROME_STORE_URL =
    'https://chromewebstore.google.com/detail/clgmndlecfeilanhmiohfjmgfgilpjic';

  async function installChromiumCompanion() {
    try {
      await openUrl(CHROME_STORE_URL);
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'browser:settings.install-link-failed',
        severity: 'error',
        retryable: true,
        context: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  let availableBrowsers = $state<BrowserId[]>([]);
  let pairedBrowsers = $state<BrowserKey[]>([]);
  let pendingPairings = $state<PendingPairing[]>([]);
  let connectionStatus = $state<Record<string, boolean>>({});

  function familyKey(family: string, variant: string): string {
    return `${family}:${variant}`;
  }

  async function refresh() {
    availableBrowsers = await browserService.listAvailableBrowsers(null);
    pairedBrowsers = await browserService.listPairedBrowsers(null);
    pendingPairings = (await browserListPendingPairings()) ?? [];
    const status: Record<string, boolean> = {};
    for (const fam of ['chromium', 'firefox', 'safari'] as const) {
      status[fam] = await browserService.isCompanionInstalled(null, fam as BrowserFamily);
    }
    connectionStatus = status;
  }

  async function resolve(id: string, decision: 'allow' | 'deny') {
    const ok = await browserResolvePairing(id, decision);
    if (!ok) {
      feedbackService.report({
        source: 'frontend',
        kind: 'browser:settings.resolve-failed',
        severity: 'error',
        retryable: false,
        context: { message: 'browser_resolve_pairing failed' },
      });
      return;
    }
    await refresh();
  }

  async function revoke(family: string, variant: string) {
    const ok = await browserRevokePairing(family, variant);
    if (!ok) {
      feedbackService.report({
        source: 'frontend',
        kind: 'browser:settings.revoke-failed',
        severity: 'error',
        retryable: false,
        context: { message: 'browser_revoke_pairing failed' },
      });
      return;
    }
    await refresh();
  }

  let unlisteners: Array<() => void> = [];

  onMount(async () => {
    await refresh();
    unlisteners.push(await listen<PairRequestEvent>('browser:pair-request', () => refresh()));
    unlisteners.push(await listen('browser:companion-connected', () => refresh()));
    unlisteners.push(await listen('browser:companion-disconnected', () => refresh()));
  });

  onDestroy(() => {
    unlisteners.forEach((fn) => fn());
  });
</script>

<div class="section-header">{t('settings.browsers.section_connected')}</div>
<div id="browsers-connected" class="anchor-group">
  {#if pendingPairings.length > 0}
    <SettingsCard>
      <div class="pending-list" data-testid="pending-list">
        {#each pendingPairings as p (p.id)}
          <div class="browser-row">
            <span class="browser-label">{p.family} · {p.variant}</span>
            <span class="pending-tag">{t('settings.browsers.pending')}</span>
            <button
              class="action-btn"
              onclick={() => resolve(p.id, 'allow')}
              data-testid="allow-{p.id}">{t('settings.browsers.allow')}</button
            >
            <button
              class="action-btn action-btn-danger"
              onclick={() => resolve(p.id, 'deny')}
              data-testid="deny-{p.id}">{t('settings.browsers.deny')}</button
            >
          </div>
        {/each}
      </div>
    </SettingsCard>
  {/if}

  {#if pairedBrowsers.length === 0}
    <div class="paired-list" data-testid="paired-list">
      <EmptyState
        compact
        message={t('settings.browsers.no_browsers')}
        description={t('settings.browsers.no_browsers_description')}
      />
    </div>
  {:else}
    <SettingsCard>
      <div class="paired-list" data-testid="paired-list">
        {#each pairedBrowsers as b (familyKey(b.family, b.variant))}
          <div class="browser-row">
            <span class="browser-label">{b.family} · {b.variant}</span>
            <span class="status" class:connected={connectionStatus[b.family]}>
              {connectionStatus[b.family]
                ? t('settings.browsers.connected')
                : t('settings.browsers.offline')}
            </span>
            <button
              class="action-btn"
              onclick={() => revoke(b.family, b.variant)}
              data-testid="revoke-{familyKey(b.family, b.variant)}"
            >
              {t('settings.browsers.revoke')}
            </button>
          </div>
        {/each}
      </div>
    </SettingsCard>
  {/if}
</div>

<div class="section-header">{t('settings.browsers.install_companion')}</div>
<div id="browsers-install">
  <SettingsCard>
    <div class="install-links">
      <p class="companion-intro">
        {t('settings.browsers.companion_description')}
      </p>
      <button
        class="btn btn-primary install-btn"
        onclick={installChromiumCompanion}
        data-testid="install-chromium"
      >
        {t('settings.browsers.install_for_chrome')}
      </button>
      <p class="companion-note">
        {t('settings.browsers.install_chrome_note')}
      </p>
    </div>
  </SettingsCard>
</div>

<style>
  .anchor-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .pending-list {
    display: flex;
    flex-direction: column;
  }

  .paired-list {
    display: flex;
    flex-direction: column;
  }

  .browser-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-6);
  }

  .browser-row:not(:last-child)::after {
    content: '';
    position: absolute;
    left: var(--space-6);
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--border-color);
  }

  .browser-label {
    flex: 1;
    min-width: 0;
    color: var(--text-primary);
    font-size: var(--font-size-md);
  }

  .pending-tag {
    font-size: var(--font-size-2xs);
    font-weight: 700;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .status {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }

  .status.connected {
    color: var(--accent-success);
  }

  /* Uses --bg-secondary, not --bg-tertiary — this button sits inside a
     SettingsCard, which is itself --bg-tertiary; matching that token here
     would make the button invisible (see Global Constraints). */
  .action-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background-color var(--transition-fast);
  }

  .action-btn:hover {
    background: var(--bg-hover);
  }

  .action-btn-danger {
    color: var(--accent-danger);
  }

  .install-links {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-6);
  }

  .companion-intro {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  .install-btn {
    display: inline-flex;
    align-self: flex-start;
  }

  .companion-note {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
</style>
