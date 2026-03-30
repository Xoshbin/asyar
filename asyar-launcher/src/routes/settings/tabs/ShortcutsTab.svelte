<script lang="ts">
  import { SettingsSection, Button, ShortcutRecorder } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();
</script>

<SettingsSection title="Global Shortcuts">
  <div class="mb-8 p-6 pt-2">
    <div class="mb-2 font-medium text-[var(--text-primary)]">Asyar activation shortcut</div>
    <div class="text-sm mb-6 text-[var(--text-secondary)]">
      This shortcut will show or hide Asyar from anywhere on your system
    </div>
    
    <div class="mb-6">
      <ShortcutRecorder 
        bind:modifier={handler.selectedModifier}
        bind:key={handler.selectedKey}
        placeholder="Click to set shortcut"
        disabled={handler.isSaving}
      />
    </div>
    
    <div class="flex items-center">
      <Button 
        onclick={() => handler.saveShortcutSettings()} 
        disabled={handler.isSaving}
      >
        {handler.isSaving ? 'Saving...' : 'Save Shortcut'}
      </Button>
      
      {#if handler.saveMessage}
        <div class="ml-4 text-sm font-medium" style="color: {handler.saveError ? 'var(--accent-danger)' : 'var(--accent-success)'}">
          {handler.saveMessage}
        </div>
      {/if}
    </div>
  </div>
</SettingsSection>
