<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { platform } from '@tauri-apps/plugin-os'
  import Button from '../../../components/base/Button.svelte'
  import { checkSnippetPermission, openAccessibilityPreferences } from '../../../lib/ipc/commands'

  let { granted = $bindable(false) }: { granted?: boolean } = $props()

  let isMac = $state(false)
  let loading = $state(false)

  async function check() {
    granted = (await checkSnippetPermission()) ?? false
  }

  async function openPrefs() {
    loading = true
    await openAccessibilityPreferences()
    loading = false
  }

  onMount(async () => {
    isMac = (await platform()) === 'macos'
    if (!isMac) {
      granted = true
      return
    }
    await check()
    window.addEventListener('focus', check)
  })

  onDestroy(() => window.removeEventListener('focus', check))
</script>

{#if isMac && !granted}
  <div class="axgate">
    <p class="axgate__text">
      This needs macOS <strong>Accessibility</strong> permission so Asyar can read your
      selection and type for you.
    </p>
    <Button onclick={openPrefs} disabled={loading}>
      {loading ? 'Opening…' : 'Open System Settings'}
    </Button>
    <p class="axgate__hint">Toggle Asyar on, then return here — it detects the grant automatically.</p>
  </div>
{:else if isMac && granted}
  <p class="axgate__ok">✓ Accessibility granted</p>
{/if}

<style>
  .axgate { display: flex; flex-direction: column; gap: var(--space-2); border: 1px solid var(--separator); border-radius: var(--radius-md); padding: var(--space-3); background: var(--bg-subtle); }
  .axgate__text { margin: 0; font-size: var(--font-size-md); color: var(--text-secondary); }
  .axgate__hint { margin: 0; font-size: var(--font-size-sm); color: var(--text-secondary); }
  .axgate__ok { font-size: var(--font-size-md); color: var(--asyar-brand); margin: 0; }
</style>
