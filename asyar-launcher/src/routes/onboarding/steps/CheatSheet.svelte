<script lang="ts">
  import { onMount } from 'svelte';
  import { appListen } from '../../../lib/ipc/bridgeEvents';
  import { showConfetti } from '../../../lib/ipc/windowCommands';
  import { Button, ShortcutRecorder } from '../../../components';
  import type { ShortcutBackendInfo } from '../../../lib/ipc/commands';
  import { completeStep } from '../stepLogic';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { toDisplayKeys } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import {
    fetchShortcutBackendInfo,
    getWaylandBindingGuide,
    saveHotkey,
  } from './summonSearchSetup';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';

  $effect(() => {
    onboardingNav.set({ primaryLabel: t('onboarding.open_asyar'), onPrimary: completeStep });
  });

  let modifier = $state(settingsService.currentSettings.shortcut.modifier);
  let key = $state(settingsService.currentSettings.shortcut.key);
  let showRebind = $state(false);
  let backendInfo = $state<ShortcutBackendInfo | null>(null);
  let copied = $state(false);

  const waylandGuide = $derived(getWaylandBindingGuide(backendInfo));
  // Wayland compositors own global hotkeys, so show the binding the guide asks the user to add.
  const keys = $derived(
    waylandGuide ? waylandGuide.shortcutDisplay.split('+') : toDisplayKeys(`${modifier}+${key}`),
  );

  const rows = $derived([
    { keys: 'Tab', label: t('onboarding.shortcut_ai') },
    { keys: '⌘K', label: t('onboarding.shortcut_action_panel') },
    { keys: 'Space', label: t('onboarding.cheatsheet_quick_look') },
  ]);

  onMount(() => {
    void fetchShortcutBackendInfo().then((info) => (backendInfo = info));
    // Using the hotkey just taught is the natural "done": Rust tells us when it revealed the launcher.
    const unlisten = appListen('launcher:summoned', () => {
      void showConfetti();
      void completeStep();
    });
    return () => void unlisten.then((off) => off());
  });

  async function copyWaylandSnippet() {
    if (!waylandGuide) return;
    try {
      await navigator.clipboard.writeText(waylandGuide.command);
      copied = true;
    } catch {
      // Clipboard write may fail in restricted environments; ignore.
    }
  }
</script>

<div class="done">
  <h1 class="done__title">{t('onboarding.thats_asyar')}</h1>
  <p class="done__lede">{t('onboarding.done_open_with')}</p>

  <div class="done__hotkey">
    {#each keys as k, i (i)}<kbd style:--i={i}>{k}</kbd>{/each}
  </div>

  {#if waylandGuide}
    <div class="done__wayland">
      <p class="done__wayland-notice">
        {t('onboarding.wayland_hotkey_notice', { compositor: waylandGuide.compositorLabel })}
      </p>
      <p class="done__wayland-path">
        {#if waylandGuide.configPath}
          {t('onboarding.wayland_config_file', { path: waylandGuide.configPath })}
        {:else}
          {t('onboarding.wayland_custom_shortcut_cmd')}
        {/if}
      </p>
      <div class="done__wayland-snippet">
        <pre class="done__wayland-code"><code>{waylandGuide.command}</code></pre>
        <Button class="btn-secondary" onclick={copyWaylandSnippet}>
          {copied ? t('onboarding.wayland_copied') : t('onboarding.wayland_copy_snippet')}
        </Button>
      </div>
    </div>
  {:else if showRebind}
    <ShortcutRecorder bind:modifier bind:key onsave={saveHotkey} />
  {:else}
    <button class="done__link" onclick={() => (showRebind = true)}>
      {t('onboarding.change_hotkey_hint')}
    </button>
  {/if}

  <ul class="done__sheet">
    {#each rows as row, i (row.keys)}
      <li style:--i={i}><kbd>{row.keys}</kbd><span>{row.label}</span></li>
    {/each}
  </ul>
</div>

<style>
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    text-align: center;
  }
  .done__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .done__lede {
    margin: 0;
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }
  .done__hotkey {
    display: flex;
    gap: var(--space-3);
  }
  .done__hotkey kbd {
    min-width: var(--size-3xl);
    padding: var(--space-5) var(--space-6);
    border: 1px solid var(--separator);
    border-bottom-width: 3px;
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    box-shadow: var(--shadow-md);
    font-family: inherit;
    font-size: var(--font-size-display);
    font-weight: 600;
    color: var(--text-primary);
    animation: key-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(160ms + var(--i) * 90ms);
  }
  .done__link {
    background: none;
    border: none;
    padding: 0;
    color: var(--asyar-brand);
    cursor: default;
    font-size: var(--font-size-sm);
  }
  .done__wayland {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    text-align: left;
  }
  .done__wayland-notice {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.5;
    color: var(--text-primary);
  }
  .done__wayland-path {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }
  .done__wayland-snippet {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .done__wayland-code {
    flex: 1;
    margin: 0;
    padding: var(--space-2);
    overflow-x: auto;
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
  }
  .done__sheet {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: var(--space-4) 0 0;
    display: flex;
    gap: var(--space-6);
    border-top: 1px solid var(--separator);
  }
  .done__sheet li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    animation: key-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(500ms + var(--i) * 70ms);
  }
  .done__sheet kbd {
    padding: var(--space-0-5) var(--space-2);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    font-family: inherit;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
  }
  .done__sheet span {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  @keyframes key-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
