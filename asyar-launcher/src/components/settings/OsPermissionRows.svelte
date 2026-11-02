<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import SettingsRow from './SettingsRow.svelte';
  import Button from '../base/Button.svelte';
  import { checkSnippetPermission, openAccessibilityPreferences } from '../../lib/ipc/commands';
  import { t } from '../../services/i18n';

  let { available = $bindable(false) }: { available?: boolean } = $props();

  // Accessibility is a macOS per-app grant; other platforms have nothing to show.
  let granted = $state(false);

  async function refresh() {
    try {
      granted = (await checkSnippetPermission()) ?? false;
    } catch {
      // keep previous state; re-read on the next window focus
    }
  }

  // The user flips the switch in System Settings, so re-read on return.
  onMount(async () => {
    if ((await platform()) !== 'macos') return;
    available = true;
    await refresh();
    window.addEventListener('focus', refresh);
  });
  onDestroy(() => window.removeEventListener('focus', refresh));
</script>

{#if available}
  <SettingsRow
    label={t('settings.privacy.accessibility_access')}
    description={t('settings.privacy.accessibility_access_desc')}
  >
    {#if granted}
      <span class="text-caption">{t('settings.privacy.access_granted')}</span>
    {:else}
      <Button
        onclick={() => openAccessibilityPreferences()}
        aria-label={t('settings.privacy.access_open_settings_for', {
          name: t('settings.privacy.accessibility_access'),
        })}
      >
        {t('settings.privacy.access_open_settings')}
      </Button>
    {/if}
  </SettingsRow>
{/if}
