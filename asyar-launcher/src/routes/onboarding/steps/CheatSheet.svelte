<script lang="ts">
  import { Card } from '../../../components'
  import { completeStep } from '../stepLogic'
  import { settingsService } from '../../../services/settings/settingsService.svelte'
  import { onboardingNav } from '../onboardingNav.svelte'

  $effect(() => {
    onboardingNav.set({ primaryLabel: 'Open Asyar', onPrimary: completeStep })
  })

  const mod = $derived(settingsService.currentSettings.shortcut.modifier)
  const key = $derived(settingsService.currentSettings.shortcut.key)

  const rows = $derived([
    { keys: `${mod}+${key}`, label: 'Open / hide Asyar' },
    { keys: 'Tab', label: 'Ask AI · fill command arguments' },
    { keys: '⌘K', label: 'Open the action panel' },
    { keys: 'Enter', label: 'Run the selected result' },
    { keys: 'Esc / ⌫', label: 'Go back · hide' },
  ])
</script>

<Card>
  <div class="done">
    <p class="done__kicker">You're set</p>
    <h1 class="done__title">That's Asyar — <span class="onb-hl">go fast</span></h1>
    <p class="done__lede">Keep these five shortcuts handy. You can re-run this tour anytime from Settings.</p>

    <ul class="done__sheet">
      {#each rows as row}
        <li><kbd>{row.keys}</kbd><span>{row.label}</span></li>
      {/each}
    </ul>

  </div>
</Card>

<style>
  .done { display: flex; flex-direction: column; gap: var(--space-3); }
  .done__kicker { margin: 0; font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--asyar-brand); }
  .done__title { margin: 0; font-size: var(--font-size-display); font-weight: 600; letter-spacing: -0.5px; color: var(--text-primary); }
  .done__lede { margin: 0; color: var(--text-secondary); font-size: var(--font-size-xl); line-height: 1.6; }
  .done__sheet { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .done__sheet li { display: flex; align-items: center; gap: var(--space-3); }
  .done__sheet kbd { min-width: 84px; text-align: center; background: var(--bg-subtle); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: 2px 8px; font-size: var(--font-size-md); color: var(--text-primary); }
  .done__sheet span { color: var(--text-secondary); font-size: var(--font-size-md); }
</style>
