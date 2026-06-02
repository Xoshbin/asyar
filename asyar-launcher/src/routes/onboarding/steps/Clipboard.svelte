<script lang="ts">
  import { GuidanceStep, LauncherHint } from '../../../components'
  import { settingsService } from '../../../services/settings/settingsService.svelte'
  import { advanceStep } from '../stepLogic'
  import { onboardingNav } from '../onboardingNav.svelte'

  const mod = $derived(settingsService.currentSettings.shortcut.modifier)
  const key = $derived(settingsService.currentSettings.shortcut.key)

  $effect(() => {
    onboardingNav.set({ showSkip: true, onPrimary: advanceStep, onSkip: advanceStep })
  })
</script>

<GuidanceStep kicker="Never lose a copy again" title="Clipboard history">
  {#snippet body()}
    <p>Everything you copy is saved and searchable — text, links, even images.
       Find an old copy and paste it in one keystroke.</p>
    <LauncherHint steps={[`Press ${mod}+${key}`, 'Type clip and press Enter', 'Pick any past item to paste it']} />
  {/snippet}
</GuidanceStep>
