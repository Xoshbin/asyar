<script lang="ts">
  import { completeStep } from '../stepLogic';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';
  $effect(() => {
    onboardingNav.set({ primaryLabel: t('onboarding.open_asyar'), onPrimary: completeStep });
  });

  const mod = $derived(settingsService.currentSettings.shortcut.modifier);
  const key = $derived(settingsService.currentSettings.shortcut.key);

  const rows = $derived([
    { keys: `${mod}+${key}`, label: t('onboarding.shortcut_toggle') },
    { keys: 'Tab', label: t('onboarding.shortcut_ai') },
    { keys: 'Space', label: t('onboarding.cheatsheet_quick_look') },
    { keys: '⌘K', label: t('onboarding.shortcut_action_panel') },
  ]);
</script>

<div class="done">
  <h1 class="done__title">{t('onboarding.thats_asyar')}</h1>

  <ul class="done__sheet">
    {#each rows as row, i}
      <li style:--i={i}><kbd>{row.keys}</kbd><span>{row.label}</span></li>
    {/each}
  </ul>
</div>

<style>
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    text-align: center;
  }
  .done__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .done__sheet {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .done__sheet li {
    animation: row-in var(--dur-emerge) var(--ease-emerge) both;
    animation-delay: calc(200ms + var(--i) * 70ms);
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .done__sheet kbd {
    min-width: 84px;
    text-align: center;
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: var(--space-0-5) var(--space-3);
    font-size: var(--font-size-md);
    color: var(--text-primary);
  }
  .done__sheet span {
    color: var(--text-secondary);
    font-size: var(--font-size-md);
  }

  @keyframes row-in {
    from {
      opacity: 0;
      transform: translateX(-12px);
    }
  }
</style>
