<script lang="ts">
  import { Card, Button, ShortcutRecorder } from '../../../components'
  import { advanceStep, goBackStep } from '../stepLogic'
  import { settingsService } from '../../../services/settings/settingsService.svelte'
  import { updateShortcut } from '../../../utils/shortcutManager'

  let modifier = $state(settingsService.currentSettings.shortcut.modifier)
  let key = $state(settingsService.currentSettings.shortcut.key)

  async function handleSave(detail: { modifier: string; key: string }): Promise<string | true> {
    const success = await updateShortcut(detail.modifier, detail.key)
    if (success) return true
    return 'Failed to save shortcut'
  }
</script>

<Card>
  <h1>Pick your global hotkey</h1>
  <p>Press the keys you want to use to summon Asyar.</p>

  <ShortcutRecorder bind:modifier bind:key onsave={handleSave} />

  <div class="actions">
    <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
    <Button onclick={advanceStep}>Continue</Button>
  </div>
</Card>

<style>
  .actions { display: flex; justify-content: space-between; margin-top: var(--space-5); }
</style>
