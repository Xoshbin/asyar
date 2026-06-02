<script lang="ts">
  import { Card, ShortcutRecorder, LauncherHint } from '../../../components'
  import { advanceStep } from '../stepLogic'
  import { settingsService } from '../../../services/settings/settingsService.svelte'
  import { saveHotkey } from './summonSearchSetup'
  import { onboardingNav } from '../onboardingNav.svelte'

  $effect(() => {
    onboardingNav.set({ primaryLabel: 'Continue', onPrimary: advanceStep })
  })

  let modifier = $state(settingsService.currentSettings.shortcut.modifier)
  let key = $state(settingsService.currentSettings.shortcut.key)
  let showRebind = $state(false)
</script>

<Card>
  <div class="step">
    <p class="step__kicker">The one shortcut to remember</p>
    <h1 class="step__title">Summon Asyar, then <span class="onb-hl">just type</span></h1>
    <p class="step__lede">
      Press <kbd>{modifier}+{key}</kbd> from anywhere to open Asyar. Try searching an
      app, or do quick math — type <code>1234 * 56</code> and press Enter.
    </p>

    <LauncherHint steps={[`Press ${modifier}+${key}`, 'Type an app name, or "1234 * 56"', 'Press Enter']} />

    {#if showRebind}
      <div class="step__rebind">
        <ShortcutRecorder bind:modifier bind:key onsave={saveHotkey} />
      </div>
    {:else}
      <button class="step__link" onclick={() => (showRebind = true)}>
        Prefer a different key? Change it
      </button>
    {/if}

  </div>
</Card>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-3); }
  .step__kicker { margin: 0; font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--asyar-brand); }
  .step__title { margin: 0; font-size: var(--font-size-display); font-weight: 600; letter-spacing: -0.5px; color: var(--text-primary); }
  .step__lede { margin: 0; color: var(--text-secondary); font-size: var(--font-size-xl); line-height: 1.6; }
  .step__lede kbd, .step__lede code { background: var(--bg-subtle); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: 0 6px; font-size: 0.9em; }
  .step__rebind { margin-top: var(--space-2); }
  .step__link { background: none; border: none; color: var(--asyar-brand); cursor: pointer; font-size: var(--font-size-md); padding: 0; text-align: left; }
</style>
