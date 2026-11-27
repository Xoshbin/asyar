<script lang="ts">
  import { onMount } from 'svelte';
  import { Badge, Card, Button, EmptyState, ExtensionAvatar } from '../../../components';
  import { storeIconSrc } from '../../../lib/extensionAvatar';
  import { getInstallCount } from '../../../built-in-features/store/state.svelte';
  import { advanceStep, goBackStep, fetchTopExtensions } from '../stepLogic';
  import type { ApiExtension } from '../../../built-in-features/store/state.svelte';
  import storeExtension from '../../../built-in-features/store/index.svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';
  import { listInstalledExtensions } from '../../../lib/ipc/commands';
  import { EMOJI_ID } from './emojiSetup';
  import { isExtensionInstalled, isEmojiInstalled } from '../../../lib/installedExtensions';
  import { appListen } from '../../../lib/ipc/bridgeEvents';

  let {
    onDone = advanceStep,
    onBack = goBackStep,
  }: { onDone?: () => void | Promise<void>; onBack?: () => void | Promise<void> } = $props();

  const SHOWN = 5;
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });

  // The whole store, loaded once; typing filters it locally and the top few rows show.
  let catalog = $state<ApiExtension[]>([]);
  let query = $state('');
  const extensions = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = words.length
      ? catalog.filter((ext) => {
          const text = `${ext.name} ${ext.description} ${ext.category}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
      : catalog;
    return hits.slice(0, SHOWN);
  });
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
          const extension = catalog.find((item) => item.id === id);
          return extension !== undefined && !isInstalled(extension);
        }),
      );
    }
  }

  async function load() {
    loading = true;
    try {
      const p = platform();
      const featured = await fetchTopExtensions(Number.POSITIVE_INFINITY, p);
      await refreshInstalled();
      catalog = isEmojiInstalled(installedPaths, EMOJI_ID)
        ? featured.filter((extension) => extension.slug !== 'emoji')
        : featured;
    } finally {
      loading = false;
    }
  }

  function toggle(id: number | string) {
    const ext = catalog.find((item) => item.id === id);
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
          const ext = catalog.find((e) => e.id === id);
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
    await onDone();
  }

  $effect(() => {
    const installableSelected = Array.from(selected).filter((id) => {
      const ext = catalog.find((e) => e.id === id);
      return ext !== undefined && !isInstalled(ext);
    });

    onboardingNav.set({
      showSkip: true,
      primaryLabel: t('onboarding.install_n_selected', { n: installableSelected.length }),
      primaryDisabled: installableSelected.length === 0 || installingIds.size > 0,
      glyph: 'puzzle',
      onSkip: onDone,
      onPrimary: installSelected,
      onBack,
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
      void appListen('extensions_updated', handleUpdate).then((fn) => {
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
    <h1 class="step__title">{t('onboarding.featured_heading')}</h1>

    {#if loading}
      <!-- Same row shape as the loaded list, so the window doesn't jump when the store answers. -->
      <span class="sk sk--search"></span>
      <ul class="exts" aria-busy="true" aria-label={t('common.loading')}>
        {#each Array(SHOWN) as _, i (i)}
          <li class="ext ext--skeleton" style:--i={i}>
            <span class="sk sk--avatar"></span>
            <span class="ext__body">
              <span class="sk sk--title"></span>
              <span class="sk sk--line"></span>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      {#if catalog.length === 0}
        <EmptyState message={t('onboarding.featured_store_error')} compact>
          <Button onclick={load}>{t('common.retry')}</Button>
        </EmptyState>
      {:else}
        <input
          class="exts__search"
          bind:value={query}
          placeholder={t('onboarding.featured_search', { n: catalog.length })}
        />
        {#if extensions.length === 0}
          <p class="exts__none">{t('onboarding.featured_no_match')}</p>
        {/if}
        <ul class="exts">
          {#each extensions as ext, i (ext.id)}
            {@const installed = isInstalled(ext)}
            {@const on = !installed && selected.has(ext.id)}
            <li style:--i={i}>
              <button
                type="button"
                class="ext"
                class:ext--on={on}
                aria-pressed={on}
                disabled={installed || installingIds.has(ext.id)}
                onclick={() => toggle(ext.id)}
              >
                <ExtensionAvatar
                  name={ext.name}
                  icon={storeIconSrc(ext.iconUrl ?? ext.icon_url)}
                  size={32}
                />
                <span class="ext__body">
                  <span class="ext__top">
                    <span class="ext__name">{ext.name}</span>
                    {#if ext.category}<span class="ext__category">{ext.category}</span>{/if}
                  </span>
                  <span class="ext__desc">{ext.description}</span>
                  <span class="ext__meta">
                    {t('onboarding.featured_by', { author: ext.author?.name ?? '' })}
                    · {t('onboarding.featured_installs', {
                      n: compact.format(getInstallCount(ext)),
                    })}
                  </span>
                </span>
                <span class="ext__state">
                  {#if installed}
                    <Badge text={t('onboarding.installed')} variant="success" />
                  {:else if installingIds.has(ext.id)}
                    <span class="hint">{t('common.installing')}</span>
                  {:else if failedIds.has(ext.id)}
                    <span class="error">{t('onboarding.failed')}</span>
                  {:else}
                    <span class="ext__check" aria-hidden="true">
                      {#if on}✓{/if}
                    </span>
                  {/if}
                </span>
              </button>
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
  .step__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: var(--tracking-display);
    color: var(--text-primary);
  }
  .exts__search {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--font-size-md);
    outline: none;
  }
  .exts__search:focus {
    border-color: color-mix(in srgb, var(--asyar-brand) 55%, var(--separator));
  }
  .exts__none {
    margin: 0;
    padding: var(--space-4);
    text-align: center;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }
  .exts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .exts li {
    animation: ext-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(var(--i) * 50ms);
  }
  .ext {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    min-height: calc(var(--size-xl) + var(--space-5) * 2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: default;
    transition:
      border-color var(--dur-quick) var(--ease-travel),
      background var(--dur-quick) var(--ease-travel);
  }
  .ext:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--asyar-brand) 35%, var(--separator));
  }
  .ext--on {
    border-color: color-mix(in srgb, var(--asyar-brand) 60%, transparent);
    background: color-mix(in srgb, var(--asyar-brand) 8%, var(--bg-secondary));
  }
  .ext:disabled {
    opacity: 0.75;
  }
  .ext__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .ext__top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ext__name {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .ext__category {
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    font-size: var(--font-size-2xs);
    color: var(--text-secondary);
  }
  .ext__desc {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .ext__meta {
    font-size: var(--font-size-2xs);
    color: var(--text-tertiary);
  }
  .ext__state {
    flex-shrink: 0;
  }
  .ext__check {
    display: grid;
    place-items: center;
    width: var(--size-md);
    height: var(--size-md);
    border: 1px solid var(--separator);
    border-radius: 50%;
    font-size: var(--font-size-2xs);
    color: var(--text-on-accent);
  }
  .ext--on .ext__check {
    border-color: var(--asyar-brand);
    background: var(--asyar-brand);
  }
  .sk {
    display: block;
    border-radius: var(--radius-sm);
    background: var(--bg-tertiary);
    animation: sk-pulse 1.2s ease-in-out infinite;
  }
  .sk--search {
    height: calc(var(--font-size-md) * 1.25 + var(--space-3) * 2);
    border-radius: var(--radius-md);
  }
  .sk--avatar {
    flex-shrink: 0;
    width: var(--size-xl);
    height: var(--size-xl);
    border-radius: var(--radius-md);
  }
  .sk--title {
    width: 35%;
    height: var(--font-size-md);
  }
  .sk--line {
    width: 75%;
    height: var(--font-size-sm);
  }
  .hint {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  .error {
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
  @keyframes ext-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @keyframes sk-pulse {
    50% {
      opacity: 0.5;
    }
  }
</style>
