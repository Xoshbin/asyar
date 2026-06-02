<script lang="ts">
  import { Card, Button, ShortcutRecorder, TestBox } from '../../../components'
  import { advanceStep } from '../stepLogic'
  import { DEFAULT_GRAMMAR_FIX_HOTKEY } from '../../../built-in-features/agents/defaultAgent'
  import AccessibilityGate from './AccessibilityGate.svelte'
  import { agentService } from '../../../built-in-features/agents/agentService.svelte'
  import { setUpHiddenCommand } from './hiddenCommandsSetup'
  import { onboardingNav } from '../onboardingNav.svelte'

  let modifier = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.modifier)
  let key = $state(DEFAULT_GRAMMAR_FIX_HOTKEY.key)
  let axGranted = $state(false)
  let configured = $state(false)
  let working = $state(false)
  let error = $state('')

  const aiReady = $derived(!!agentService.getDefaultAgent())
  const ready = $derived(configured && axGranted)

  async function recordHotkey(detail: { modifier: string; key: string }): Promise<true> {
    modifier = detail.modifier
    key = detail.key
    return true
  }

  $effect(() => {
    onboardingNav.set({ primaryLabel: configured ? 'Continue' : 'Skip', onPrimary: advanceStep })
  })

  async function setUp() {
    working = true
    error = ''
    try {
      const res = await setUpHiddenCommand(modifier, key)
      configured = res.ok
      if (!res.ok) error = res.error ?? 'Something went wrong.'
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      working = false
    }
  }
</script>

<Card>
  <div class="step">
    <p class="step__kicker">Magic with no window</p>
    <h1 class="step__title">Hidden <span class="onb-hl">AI commands</span></h1>
    <p class="step__lede">
      Select text in any app, press a hotkey, and Asyar rewrites it in place — no window,
      no copy-paste. We'll set up a "Grammar Fix" command you can try right here.
    </p>

    <div class="examples">
      <span class="examples__label">A few you can build:</span>
      <ul class="examples__list">
        <li>✍️ Fix grammar &amp; spelling</li>
        <li>🌍 Translate selection to English</li>
        <li>🎩 Make it more formal</li>
        <li>✂️ Summarize in one line</li>
      </ul>
    </div>

    {#if !aiReady}
      <p class="step__warn">Connect an AI provider in the previous step to enable this.</p>
    {:else}
      <div class="step__setup">
        <span class="step__label">1 · Pick a hotkey</span>
        <ShortcutRecorder bind:modifier bind:key onsave={recordHotkey} />
        <span class="step__label">2 · Permission</span>
        <AccessibilityGate bind:granted={axGranted} />
        <Button onclick={setUp} disabled={working || configured}>
          {configured ? '✓ Grammar Fix ready' : working ? 'Setting up…' : '3 · Create the command'}
        </Button>
        {#if error}<p class="step__error">{error}</p>{/if}
      </div>

      <TestBox
        label="Try it — select the line below and press your hotkey anywhere you type"
        prefill="i has a apple and it are very tasty"
        multiline
        enabled={ready}
        enabledHint={`Select the text and press ${modifier}+${key} — also works in any other app`}
        disabledHint="Finish the 3 setup steps to try it here"
      />
    {/if}

  </div>
</Card>

<style>
  .step { display: flex; flex-direction: column; gap: var(--space-3); }
  .step__kicker { margin: 0; font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--asyar-brand); }
  .step__title { margin: 0; font-size: var(--font-size-display); font-weight: 600; letter-spacing: -0.5px; color: var(--text-primary); }
  .step__lede { margin: 0; color: var(--text-secondary); font-size: var(--font-size-xl); line-height: 1.6; }
  .step__warn { margin: 0; color: var(--accent-danger); font-size: var(--font-size-md); }
  .step__setup { display: flex; flex-direction: column; gap: var(--space-2); }
  .step__label { font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
  .step__error { margin: var(--space-2) 0 0; color: var(--accent-danger); font-size: var(--font-size-md); }
  .examples { display: flex; flex-direction: column; gap: var(--space-2); }
  .examples__label { font-size: var(--font-size-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
  .examples__list { margin: 0; padding-left: var(--space-4); color: var(--text-secondary); font-size: var(--font-size-md); line-height: 1.9; }
</style>
