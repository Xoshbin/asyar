<script lang="ts">
  import { GuidanceStep, LauncherHint } from '../../../components';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { advanceStep } from '../stepLogic';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { t } from '../../../services/i18n';

  const mod = $derived(settingsService.currentSettings.shortcut.modifier);
  const key = $derived(settingsService.currentSettings.shortcut.key);

  $effect(() => {
    onboardingNav.set({ showSkip: true, onPrimary: advanceStep, onSkip: advanceStep });
  });
</script>

<GuidanceStep kicker={t('onboarding.clipboard_kicker')} title={t('features.clipboard.title')}>
  {#snippet body()}
    <p>
      Everything you copy is saved and searchable — text, links, even images. Find an old copy and
      paste it in one keystroke.
    </p>
    <LauncherHint
      steps={[`Press ${mod}+${key}`, 'Type clip and press Enter', 'Pick any past item to paste it']}
    />
    <p>
      Need several at once? Cmd/Ctrl-click (or Cmd/Ctrl+↑/↓) to select multiple items, then press
      Enter to <span class="onb-hl">merge them into a single paste</span>.
    </p>
  {/snippet}
</GuidanceStep>
