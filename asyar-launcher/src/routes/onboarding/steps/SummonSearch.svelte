<script lang="ts">
  import { onMount } from 'svelte';
  import { Button, Card, ShortcutRecorder, LauncherHint } from '../../../components';
  import type { ShortcutBackendInfo } from '../../../lib/ipc/commands';
  import { advanceStep } from '../stepLogic';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import {
    fetchShortcutBackendInfo,
    getWaylandBindingGuide,
    saveHotkey,
  } from './summonSearchSetup';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';

  $effect(() => {
    onboardingNav.set({ primaryLabel: t('onboarding.continue'), onPrimary: advanceStep });
  });

  let modifier = $state(settingsService.currentSettings.shortcut.modifier);
  let key = $state(settingsService.currentSettings.shortcut.key);
  let showRebind = $state(false);
  let backendInfo = $state<ShortcutBackendInfo | null>(null);
  let copied = $state(false);

  const waylandGuide = $derived(getWaylandBindingGuide(backendInfo));

  onMount(async () => {
    backendInfo = await fetchShortcutBackendInfo();
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

<Card>
  <div class="step">
    <p class="step__kicker">{t('onboarding.summon_title')}</p>
    <h1 class="step__title">{t('onboarding.summon_heading')}</h1>
    <p class="step__lede">
      {t('onboarding.summon_lede_pre')}
      <kbd>{waylandGuide ? waylandGuide.shortcutDisplay : `${modifier}+${key}`}</kbd>
      {t('onboarding.summon_lede_mid')} <code>1234 * 56</code>
      {t('onboarding.summon_lede_post')}
    </p>

    <LauncherHint
      steps={[
        waylandGuide
          ? t('onboarding.wayland_hint_bind_and_press', { shortcut: waylandGuide.shortcutDisplay })
          : t('onboarding.hint_press_shortcut', { shortcut: `${modifier}+${key}` }),
        t('onboarding.summon_hint_type'),
        t('onboarding.summon_hint_enter'),
      ]}
    />

    <p class="step__tip">
      💡 <strong>{t('onboarding.quick_look_label')}</strong>
      {t('onboarding.summon_quick_look_tip')}
    </p>

    {#if waylandGuide}
      <div class="step__wayland">
        <p class="step__wayland-notice">
          {t('onboarding.wayland_hotkey_notice', { compositor: waylandGuide.compositorLabel })}
        </p>
        <p class="step__wayland-path">
          {#if waylandGuide.configPath}
            {t('onboarding.wayland_config_file', { path: waylandGuide.configPath })}
          {:else}
            {t('onboarding.wayland_custom_shortcut_cmd')}
          {/if}
        </p>
        <div class="step__wayland-snippet">
          <pre class="step__wayland-code"><code>{waylandGuide.command}</code></pre>
          <Button class="btn-secondary" onclick={copyWaylandSnippet}>
            {copied ? t('onboarding.wayland_copied') : t('onboarding.wayland_copy_snippet')}
          </Button>
        </div>
      </div>
    {:else if showRebind}
      <div class="step__rebind">
        <ShortcutRecorder bind:modifier bind:key onsave={saveHotkey} />
      </div>
    {:else}
      <button class="step__link" onclick={() => (showRebind = true)}>
        {t('onboarding.change_hotkey_hint')}
      </button>
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
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
  }
  .step__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .step__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }
  .step__tip {
    margin: var(--space-1) 0 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
  .step__lede kbd,
  .step__lede code {
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: 0 var(--space-2);
    font-size: 0.9em;
  }
  .step__wayland {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-top: var(--space-2);
  }
  .step__wayland-notice {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
  .step__wayland-path {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }
  .step__wayland-snippet {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .step__wayland-code {
    flex: 1;
    margin: 0;
    padding: var(--space-2);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    overflow-x: auto;
  }
  .step__rebind {
    margin-top: var(--space-2);
  }
  .step__link {
    background: none;
    border: none;
    color: var(--asyar-brand);
    cursor: pointer;
    font-size: var(--font-size-md);
    padding: 0;
    text-align: left;
  }
</style>
