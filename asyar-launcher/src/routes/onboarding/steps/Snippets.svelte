<script lang="ts">
  import { Card, Button, ExpansionDemo } from '../../../components'
  import { advanceStep } from '../stepLogic'
  import AccessibilityGate from './AccessibilityGate.svelte'
  import { seedSampleSnippet, enableExpansion } from './snippetsSetup'
  import { onboardingNav } from '../onboardingNav.svelte'

  let seeded = $state(false)
  let enabled = $state(false)
  let axGranted = $state(false)
  let working = $state(false)
  let error = $state('')

  $effect(() => {
    onboardingNav.set({ primaryLabel: seeded ? 'Continue' : 'Skip', onPrimary: advanceStep })
  })

  async function setUp() {
    working = true
    error = ''
    try {
      seedSampleSnippet()
      seeded = true
      const ok = await enableExpansion()
      if (!ok) {
        error = 'Could not enable expansion — grant Accessibility permission above and try again.'
      } else {
        enabled = true
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      working = false
    }
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">Type less, everywhere</p>
    <h1 class="step__title"><span class="onb-hl">Snippets</span></h1>
    <p class="step__lede">
      Save a keyword like <code>;email</code> and it expands into full text in any app you
      type in — addresses, signatures, boilerplate. Snippets can include placeholders like
      <code>{'{Date}'}</code> or <code>{'{Clipboard Text}'}</code>. We'll add a sample
      <code>;email</code> snippet.
    </p>

    <div class="step__setup">
      <span class="step__label">1 · Permission</span>
      <AccessibilityGate bind:granted={axGranted} />
      <Button onclick={setUp} disabled={working || (seeded && enabled)}>
        {seeded && enabled ? '✓ Sample snippet ready' : working ? 'Setting up…' : '2 · Add sample & enable'}
      </Button>
      {#if error}<p class="step__error">{error}</p>{/if}
    </div>

    <ExpansionDemo
      trigger=";email"
      result="you@example.com"
      note="Heads up: snippets expand in other apps — not inside Asyar's own windows. Add the sample above, then type ;email anywhere you type."
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
