<script lang="ts">
  import { Card, Button, LauncherHint } from '../../../components'
  import { advanceStep } from '../stepLogic'
  import { settingsService } from '../../../services/settings/settingsService.svelte'
  import { seedSamplePortal } from './portalsSetup'
  import { onboardingNav } from '../onboardingNav.svelte'

  $effect(() => {
    onboardingNav.set({ showSkip: true, onPrimary: advanceStep, onSkip: advanceStep })
  })

  const mod = $derived(settingsService.currentSettings.shortcut.modifier)
  const key = $derived(settingsService.currentSettings.shortcut.key)
  let seeded = $state(false)

  function addSample() {
    seedSamplePortal()
    seeded = true
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">Turn any site into a command</p>
    <h1 class="step__title"><span class="onb-hl">Portals</span></h1>
    <p class="step__lede">
      A portal is a saved URL with a <code>{'{query}'}</code> placeholder — type a few
      letters and jump straight into a search. We'll add a sample "Search GitHub" portal
      so you can try it.
    </p>

    <Button class="btn-secondary" onclick={addSample} disabled={seeded}>
      {seeded ? '✓ Sample added' : 'Add sample portal'}
    </Button>

    <LauncherHint steps={[`Press ${mod}+${key}`, 'Type Search GitHub', 'Press Tab, type a query, Enter']} />

  </div>
</Card>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-3); }
  .step__kicker { margin: 0; font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--asyar-brand); }
  .step__title { margin: 0; font-size: var(--font-size-display); font-weight: 600; letter-spacing: -0.5px; color: var(--text-primary); }
  .step__lede { margin: 0; color: var(--text-secondary); font-size: var(--font-size-xl); line-height: 1.6; }
  .step__lede code { background: var(--bg-subtle); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: 0 6px; }
</style>
