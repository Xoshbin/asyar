<script lang="ts">
  import { t } from '../../../services/i18n';
  import { onMount, onDestroy } from 'svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import Button from '../../../components/base/Button.svelte';
  import { checkSnippetPermission, openAccessibilityPreferences } from '../../../lib/ipc/commands';

  let { granted = $bindable(false) }: { granted?: boolean } = $props();

  let isMac = $state(false);
  let loading = $state(false);

  async function check() {
    granted = (await checkSnippetPermission()) ?? false;
  }

  async function openPrefs() {
    loading = true;
    await openAccessibilityPreferences();
    loading = false;
  }

  onMount(async () => {
    isMac = (await platform()) === 'macos';
    if (!isMac) {
      granted = true;
      return;
    }
    await check();
    window.addEventListener('focus', check);
  });

  onDestroy(() => window.removeEventListener('focus', check));
</script>

{#if isMac && !granted}
  <div class="axgate">
    <p class="axgate__text">
      {t('onboarding.ax_text_pre')} <strong>{t('onboarding.ax_name')}</strong>
      {t('onboarding.ax_text_post')}
    </p>
    <Button onclick={openPrefs} disabled={loading}>
      {loading ? t('onboarding.ax_opening') : t('onboarding.ax_open_settings')}
    </Button>
    <p class="axgate__hint">{t('onboarding.ax_hint')}</p>
  </div>
{:else if isMac && granted}
  <p class="axgate__ok">{t('onboarding.ax_granted')}</p>
{/if}

<style>
  .axgate {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--bg-tertiary);
  }
  .axgate__text {
    margin: 0;
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }
  .axgate__hint {
    margin: 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .axgate__ok {
    font-size: var(--font-size-md);
    color: var(--asyar-brand);
    margin: 0;
  }
</style>
