<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Card, Button, StatusDot } from '../../../components'
  import { advanceStep, goBackStep } from '../stepLogic'
  import { invoke } from '@tauri-apps/api/core'

  let granted = $state(false)
  let loading = $state(false)

  async function check() {
    try {
      granted = await invoke<boolean>('check_snippet_permission')
    } catch {
      granted = false
    }
  }

  async function openPrefs() {
    loading = true
    try {
      await invoke('open_accessibility_preferences')
    } finally {
      loading = false
    }
  }

  onMount(() => {
    void check()
    window.addEventListener('focus', check)
  })

  onDestroy(() => {
    window.removeEventListener('focus', check)
  })
</script>

<Card>
  <h1>Grant accessibility access</h1>
  <p>
    Asyar uses the macOS Accessibility API to paste snippets and capture
    selections. You can grant this now or later.
  </p>

  <div class="status">
    <StatusDot color={granted ? 'success' : 'warning'} />
    <span>{granted ? 'Granted' : 'Not granted yet'}</span>
  </div>

  {#if !granted}
    <Button onclick={openPrefs} disabled={loading}>
      Open System Settings
    </Button>
  {/if}

  <div class="actions">
    <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
    <Button onclick={advanceStep}>{granted ? 'Continue' : 'Skip for now'}</Button>
  </div>
</Card>

<style>
  .status { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-3) 0; }
  .actions { display: flex; justify-content: space-between; margin-top: var(--space-5); }
</style>
