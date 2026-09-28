<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Card, Button, EmptyState, LoadingState } from '../../../components';
  import { advanceStep, fetchTopExtensions } from '../stepLogic';
  import type { ApiExtension } from '../../../built-in-features/store/state.svelte';
  import storeExtension from '../../../built-in-features/store/index.svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import { listen } from '@tauri-apps/api/event';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';
  import { listInstalledExtensions } from '../../../lib/ipc/commands';
  import { EMOJI_ID } from './emojiSetup';
  import { isExtensionInstalled, isEmojiInstalled } from '../../../lib/installedExtensions';

  let extensions = $state<ApiExtension[]>([]);
  let selected = $state<Set<number | string>>(new Set());
  let loading = $state(true);
  let installingIds = $state<Set<number | string>>(new Set());
  let failedIds = $state<Set<number | string>>(new Set());
  let installedPaths = $state<string[]>([]);

  function isInstalled(extension: ApiExtension): boolean {
    return isExtensionInstalled(extension, installedPaths);
  }

  async function refreshInstalled(): Promise<void> {
    installedPaths = (await listInstalledExtensions()) ?? [];
    if (selected.size > 0) {
      selected = new Set(
        Array.from(selected).filter((id) => {
          const extension = extensions.find((item) => item.id === id);
          return extension !== undefined && !isInstalled(extension);
        }),
      );
    }
  }

  async function load() {
    loading = true;
    try {
      const p = platform();
      const featured = await fetchTopExtensions(5, p);
      await refreshInstalled();
      extensions = isEmojiInstalled(installedPaths, EMOJI_ID)
        ? featured.filter((extension) => extension.slug !== 'emoji')
        : featured;
    } finally {
      loading = false;
    }
  }

  function toggle(id: number | string) {
    const ext = extensions.find((item) => item.id === id);
    if (ext && isInstalled(ext)) return;
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selected = next;
  }

  async function installSelected() {
    const ids = Array.from(selected);
    await Promise.allSettled(
      ids.map(async (id) => {
        installingIds = new Set([...installingIds, id]);
        try {
          const ext = extensions.find((e) => e.id === id);
          if (ext) await storeExtension.installExtension(ext.slug, ext.id, ext.name, ext);
        } catch {
          failedIds = new Set([...failedIds, id]);
        } finally {
          const next = new Set(installingIds);
          next.delete(id);
          installingIds = next;
        }
      }),
    );
    await refreshInstalled();
    await advanceStep();
  }

  $effect(() => {
    const installableSelected = Array.from(selected).filter((id) => {
      const ext = extensions.find((e) => e.id === id);
      return ext !== undefined && !isInstalled(ext);
    });

    onboardingNav.set({
      showSkip: true,
      primaryLabel: `Install ${installableSelected.length} selected`,
      primaryDisabled: installableSelected.length === 0 || installingIds.size > 0,
      onSkip: advanceStep,
      onPrimary: installSelected,
    });
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;

    const handleUpdate = () => {
      void refreshInstalled();
    };

    window.addEventListener('store-extension-installed', handleUpdate);
    window.addEventListener('store-extension-uninstalled', handleUpdate);
    window.addEventListener('store-extension-updated', handleUpdate);

    try {
      void listen('extensions_updated', handleUpdate).then((fn) => {
        unlisten = fn;
      });
    } catch {
      // Web / test environments
    }

    void load();

    return () => {
      window.removeEventListener('store-extension-installed', handleUpdate);
      window.removeEventListener('store-extension-uninstalled', handleUpdate);
      window.removeEventListener('store-extension-updated', handleUpdate);
      if (unlisten) unlisten();
    };
  });
</script>

<Card>
  <div class="step">
    <p class="step__kicker">{t('onboarding.featured_title')}</p>
    <h1 class="step__title">{t('onboarding.featured_heading')}</h1>
    <p class="step__lede">{t('onboarding.featured_desc')}</p>

    {#if loading}
      <LoadingState message={t('common.loading')} />
    {:else}
      {#if extensions.length === 0}
        <EmptyState message={t('onboarding.featured_store_error')} compact>
          <Button onclick={load}>{t('common.retry')}</Button>
        </EmptyState>
      {:else}
        <ul class="list">
          {#each extensions as ext (ext.id)}
            {@const installed = isInstalled(ext)}
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={!installed && selected.has(ext.id)}
                  onchange={() => toggle(ext.id)}
                  disabled={installed || installingIds.has(ext.id)}
                />
                <span class="name">{ext.name}</span>
                {#if installed}<Badge text="Installed" variant="success" />{/if}
                {#if installingIds.has(ext.id)}<span class="hint">Installing…</span>{/if}
                {#if failedIds.has(ext.id)}<span class="error">Failed</span>{/if}
              </label>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="step__tip">
        <span class="step__tip-badge">💡 {t('onboarding.featured_empty_tip_badge')}</span>
        <p class="step__tip-text">
          {t('onboarding.featured_empty_store_tip')}
        </p>
      </div>
    {/if}
  </div>
</Card>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .step__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    color: var(--asyar-brand);
  }
  .step__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
  }
  .step__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: var(--space-2) 0;
  }
  .list li {
    padding: var(--space-2) 0;
  }
  .name {
    margin-left: var(--space-2);
  }
  .hint {
    margin-left: var(--space-2);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .error {
    margin-left: var(--space-2);
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
  }
  .step__tip {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--bg-tertiary);
  }
  .step__tip-badge {
    align-self: flex-start;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--asyar-brand);
  }
  .step__tip-text {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    line-height: 1.5;
  }
</style>
