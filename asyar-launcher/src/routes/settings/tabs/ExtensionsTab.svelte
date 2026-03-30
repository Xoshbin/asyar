<script lang="ts">
  import { SettingsSection, Toggle, Button, EmptyState, LoadingState, Badge } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { extensionStateManager } from '../../../services/extension/extensionStateManager.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();
</script>

<SettingsSection title="Installed Extensions">
  <div class="p-6">
    {#if handler.isLoadingExtensions}
      <LoadingState message="Loading extensions..." />
    {:else if handler.extensionError}
      <div class="py-8 text-center">
        <div class="mb-2" style="color: var(--accent-danger)">⚠️ {handler.extensionError}</div>
        <Button onclick={() => handler.loadExtensions()}>Retry</Button>
      </div>
    {:else if handler.extensions.length === 0}
      <EmptyState message="No extensions installed" description="Extensions add new functionality to Asyar" />
      {#if import.meta.env?.DEV}
        <p class="mt-4 p-2 rounded text-xs" style="background: color-mix(in srgb, var(--accent-warning) 12%, transparent); color: var(--accent-warning);">Debug: Extensions array is empty</p>
      {/if}
    {:else}
      <!-- Debug info in development -->
      {#if import.meta.env?.DEV}
        <div class="mb-4 p-2 rounded text-xs" style="background: color-mix(in srgb, var(--accent-primary) 12%, transparent); color: var(--accent-primary);">
           {handler.extensions.length} extensions installed
        </div>
      {/if}
      
      {#if handler.saveMessage}
        <div class="mb-4 p-3 rounded" style="background: color-mix(in srgb, {handler.saveError ? 'var(--accent-danger)' : 'var(--accent-success)'} 12%, transparent); color: {handler.saveError ? 'var(--accent-danger)' : 'var(--accent-success)'};">
          {handler.saveMessage}
        </div>
      {/if}
      
      <div class="grid gap-4">
        {#each handler.extensions as extension}
          <div class="p-4 border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors">
            <div class="flex items-start">
              <div class="w-10 h-10 rounded-md bg-[var(--bg-secondary)] flex items-center justify-center mr-4 flex-shrink-0">
                {#if extension.iconUrl}
                  <img src={extension.iconUrl} alt={extension.title} class="w-6 h-6" />
                {:else}
                  <div class="text-lg text-[var(--text-secondary)]">{extension.title ? extension.title[0].toUpperCase() : 'E'}</div>
                {/if}
              </div>
              <div class="flex-1">
                <div class="flex items-center justify-between">
                  <div class="font-medium text-[var(--text-primary)]">{extension.title}</div>
                  {#if extension.version}
                    <Badge text="v{extension.version}" variant="default" mono />
                  {/if}
                </div>
                <div class="text-sm text-[var(--text-secondary)] mt-1">{extension.subtitle || "No description available"}</div>
                {#if extension.type}
                  <div class="mt-2 flex items-center gap-2">
                    <Badge text={extension.type} variant="default" />

                    {#if extension.compatibility?.status === 'sdkMismatch'}
                      <Badge text="⚠️ Requires SDK {extension.compatibility.required}" variant="danger" />
                    {/if}

                    {#if extension.compatibility?.status === 'appVersionTooOld'}
                      <Badge text="⚠️ Requires app v{extension.compatibility.required}+" variant="danger" />
                    {/if}
                  </div>
                {/if}
              </div>
              
              <!-- Extension actions -->
              <div class="ml-4 flex flex-col items-end">
                <div class="flex items-center gap-2">
                  <Toggle 
                    checked={extension.enabled === true}
                    disabled={
                      handler.togglingExtension === extension.title || 
                      extensionStateManager.extensionUninstallInProgress === extension.id ||
                      (extension.compatibility?.status !== 'compatible' && extension.compatibility?.status !== 'unknown')
                    }
                    onchange={() => handler.toggleExtension(extension)}
                  />
                  
                  <!-- Uninstall button -->
                  <button
                    class="text-xs hover:underline"
                    style="color: var(--accent-danger)"
                    onclick={() => handler.openUninstallDialog(extension)}
                    disabled={extensionStateManager.extensionUninstallInProgress === extension.id}
                  >
                    {extensionStateManager.extensionUninstallInProgress === extension.id ? 'Uninstalling...' : 'Uninstall'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
      
      <div class="mt-6 text-sm text-[var(--text-tertiary)]">
        <p>Extension changes will take effect after restarting Asyar.</p>
      </div>
    {/if}
  </div>
</SettingsSection>
