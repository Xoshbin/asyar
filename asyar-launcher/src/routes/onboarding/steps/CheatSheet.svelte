<script lang="ts">
  import { Card } from '../../../components';
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
    { keys: '⌘K', label: t('onboarding.shortcut_action_panel') },
    { keys: 'Enter', label: t('onboarding.shortcut_run') },
    { keys: 'Esc / ⌫', label: t('onboarding.shortcut_back') },
  ]);
</script>

<Card>
  <div class="done">
    <p class="done__kicker">{t('onboarding.youre_set')}</p>
    <h1 class="done__title">{t('onboarding.thats_asyar')}</h1>
    <p class="done__lede">
      {t('onboarding.cheatsheet_desc')}
    </p>

    <ul class="done__sheet">
      {#each rows as row}
        <li><kbd>{row.keys}</kbd><span>{row.label}</span></li>
      {/each}
    </ul>
  </div>
</Card>

<style>
  .done {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .done__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
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
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
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
</style>
