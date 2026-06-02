<script lang="ts">
  import { Card, Button, ExpansionDemo } from '../../../components'
  import { advanceStep } from '../stepLogic'
  import AccessibilityGate from './AccessibilityGate.svelte'
  import { installEmoji } from './emojiSetup'
  import { onboardingNav } from '../onboardingNav.svelte'

  let installed = $state(false)
  let installing = $state(false)
  let axGranted = $state(false)
  let error = $state('')

  $effect(() => {
    onboardingNav.set({ primaryLabel: installed ? 'Continue' : 'Skip', onPrimary: advanceStep })
  })

  async function doInstall() {
    installing = true
    error = ''
    try {
      installed = await installEmoji()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      installing = false
    }
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">Faster than an emoji picker</p>
    <h1 class="step__title">Emoji <span class="onb-hl">shortcodes</span></h1>
    <p class="step__lede">
      Type <code>:party:</code> and it becomes 🎉 — anywhere you type. Install the Emoji
      extension, then try it in any app you type in.
    </p>

    <div class="step__setup">
      <span class="step__label">1 · Install</span>
      <Button onclick={doInstall} disabled={installing || installed}>
        {installed ? '✓ Emoji installed' : installing ? 'Installing…' : 'Install Emoji extension'}
      </Button>
      {#if error}<p class="step__error">{error}</p>{/if}
      <span class="step__label">2 · Permission</span>
      <AccessibilityGate bind:granted={axGranted} />
    </div>

    <ExpansionDemo
      trigger=":party:"
      result="🎉"
      note="Heads up: shortcodes expand in other apps (Notes, Slack, your editor) — not inside Asyar's own windows. Install above, then try it anywhere you type."
    />

  </div>
</Card>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-3); }
  .step__kicker { margin: 0; font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--asyar-brand); }
  .step__title { margin: 0; font-size: var(--font-size-display); font-weight: 600; letter-spacing: -0.5px; color: var(--text-primary); }
  .step__lede { margin: 0; color: var(--text-secondary); font-size: var(--font-size-xl); line-height: 1.6; }
  .step__lede code { background: var(--bg-subtle); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: 0 6px; }
  .step__setup { display: flex; flex-direction: column; gap: var(--space-2); }
  .step__label { font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
  .step__error { margin: var(--space-2) 0 0; color: var(--accent-danger); font-size: var(--font-size-md); }
</style>
