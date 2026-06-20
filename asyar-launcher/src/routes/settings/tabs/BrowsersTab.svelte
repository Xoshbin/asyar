<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { browserService } from '../../../services/browser/browserService';
  import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';
  import type { BrowserId, BrowserKey, BrowserFamily } from 'asyar-sdk/contracts';

  type PendingPairing = { id: string; family: string; variant: string };
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
      diagnosticsService.report({
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
    try {
      availableBrowsers = await browserService.listAvailableBrowsers();
      pairedBrowsers = await browserService.listPairedBrowsers();
      pendingPairings = await invoke<PendingPairing[]>('browser_list_pending_pairings');
      const status: Record<string, boolean> = {};
      for (const fam of ['chromium', 'firefox', 'safari'] as const) {
        status[fam] = await browserService.isCompanionInstalled(fam as BrowserFamily);
      }
      connectionStatus = status;
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'browser:settings.refresh-failed',
        severity: 'warning',
        retryable: true,
        context: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  async function resolve(id: string, decision: 'allow' | 'deny') {
    try {
      await invoke('browser_resolve_pairing', { pairingId: id, decision });
      await refresh();
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'browser:settings.resolve-failed',
        severity: 'error',
        retryable: false,
        context: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  async function revoke(family: string, variant: string) {
    try {
      await invoke('browser_revoke_pairing', { family, variant });
      await refresh();
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend',
        kind: 'browser:settings.revoke-failed',
        severity: 'error',
        retryable: false,
        context: { message: err instanceof Error ? err.message : String(err) },
      });
    }
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

<section class="settings-section">
  <h2>Browsers</h2>

  {#if pendingPairings.length > 0}
    <div class="pending-list" data-testid="pending-list">
      <h3>Pending pairing requests</h3>
      {#each pendingPairings as p (p.id)}
        <article class="pending-item">
          <span class="browser-label">{p.family} · {p.variant}</span>
          <button class="action-btn" onclick={() => resolve(p.id, 'allow')} data-testid="allow-{p.id}">Allow</button>
          <button class="action-btn" onclick={() => resolve(p.id, 'deny')} data-testid="deny-{p.id}">Deny</button>
        </article>
      {/each}
    </div>
  {/if}

  <div class="paired-list" data-testid="paired-list">
    <h3>Connected browsers</h3>
    {#if pairedBrowsers.length === 0}
      <p class="empty">
        No browsers paired yet. Install the Asyar Companion extension below — once it's
        running, it pairs automatically and your browser shows up here.
      </p>
    {:else}
      {#each pairedBrowsers as b (familyKey(b.family, b.variant))}
        <article class="paired-item">
          <span class="browser-label">{b.family} · {b.variant}</span>
          <span class="status" class:connected={connectionStatus[b.family]}>
            {connectionStatus[b.family] ? 'connected' : 'offline'}
          </span>
          <button class="action-btn" onclick={() => revoke(b.family, b.variant)} data-testid="revoke-{familyKey(b.family, b.variant)}">
            Revoke
          </button>
        </article>
      {/each}
    {/if}
  </div>

  <div class="install-links">
    <h3>Install the Asyar Companion</h3>
    <p class="companion-intro">
      Asyar's browser features need a small companion extension installed in your browser.
      The two work as a pair: the companion streams your open tabs, bookmarks, and history to
      Asyar so you can search and control them from here. Install it, and it pairs with this
      launcher automatically.
    </p>
    <button
      class="btn btn-primary install-btn"
      onclick={installChromiumCompanion}
      data-testid="install-chromium"
    >
      Install for Chrome
    </button>
    <p class="companion-note">
      Works for Chrome, Brave, Edge, Arc, and Vivaldi. Firefox and Safari companions are
      coming soon.
    </p>
  </div>
</section>

<style>
  .settings-section {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  h2 {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  h3 {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 var(--space-2) 0;
  }

  .pending-item,
  .paired-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .browser-label {
    flex: 1;
    color: var(--text-primary);
  }

  .status {
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }

  .status.connected {
    color: var(--accent-success);
  }

  .empty {
    color: var(--text-tertiary);
    font-style: italic;
    margin: 0;
  }

  .action-btn {
    padding: var(--space-1) var(--space-3);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    cursor: pointer;
    transition: background-color var(--transition-normal);
  }

  .action-btn:hover {
    background: var(--bg-hover);
  }

  .companion-intro {
    margin: 0 0 var(--space-3) 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }

  .install-btn {
    display: inline-flex;
  }

  .companion-note {
    margin: var(--space-2) 0 0 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-sm);
  }
</style>
