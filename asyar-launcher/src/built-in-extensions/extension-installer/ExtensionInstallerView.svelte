<script lang="ts">
  import { onMount } from 'svelte';
  import { Input, Button } from "asyar-api";
  import { extensionInstallerState } from "./state";
  
  let url = '';

  // Bind to our state
  extensionInstallerState.subscribe(state => {
    url = state.url;
  });
  
  function handleUrlChange(e: Event) {
    extensionInstallerState.setUrl(url);
  }
  
  async function handleInstall() {
    if (!url) return;
    await extensionInstallerState.installExtension(url);
  }
  
  function handleReset() {
    extensionInstallerState.reset();
  }
</script>

<div class="min-h-[calc(100vh-72px)]">
  <div class="p-8">
    <div class="max-w-xl mx-auto">
      <h2 class="text-2xl result-title mb-6">Extension Installer</h2>
      
      <div class="space-y-4">
        <!-- URL input form -->
        <div class="space-y-2">
          <label for="extension-url" class="block text-sm font-medium">
            GitHub Repository URL or Asyar.org Extension URL
          </label>
          <Input 
            id="extension-url"
            bind:value={url}
            on:input={handleUrlChange}
            placeholder="https://github.com/username/extension"
            fullWidth
          />
          <p class="text-xs text-gray-400">
            Enter a GitHub repository URL. The extension will be cloned and installed.
          </p>
        </div>
        
        <!-- Action buttons -->
        <div class="flex gap-3">
          <Button fullWidth primary on:click={handleInstall}>
            Install Extension
          </Button>
          
          <Button on:click={handleReset}>
            Reset
          </Button>
        </div>

        <!-- Status display -->
        {#if $extensionInstallerState.isLoading}
          <div class="result-item p-4 bg-blue-100 dark:bg-blue-900">
            <span class="result-title">
              Installing {$extensionInstallerState.installingExtensionName || "extension"}...
            </span>
            <p class="text-sm mt-1">This may take a moment</p>
          </div>
        {/if}
        
        {#if $extensionInstallerState.error}
          <div class="result-item p-4 bg-red-100 dark:bg-red-900">
            <span class="result-title text-red-700 dark:text-red-300">Error</span>
            <p class="text-sm mt-1">{$extensionInstallerState.error}</p>
          </div>
        {/if}
        
        {#if $extensionInstallerState.success}
          <div class="result-item p-4 bg-green-100 dark:bg-green-900">
            <span class="result-title text-green-700 dark:text-green-300">Success</span>
            <p class="text-sm mt-1">{$extensionInstallerState.success}</p>
          </div>
        {/if}
        
        <!-- Recent installations -->
        {#if $extensionInstallerState.recentInstalls && $extensionInstallerState.recentInstalls.length > 0}
          <div class="mt-8">
            <h3 class="text-lg result-title mb-3">Recent Installations</h3>
            <div class="custom-scrollbar max-h-80">
              {#each $extensionInstallerState.recentInstalls as install}
                <div class="result-item p-3 mb-2 flex justify-between">
                  <div>
                    <span class="result-title">{install.name}</span>
                    <p class="text-xs text-gray-500">{install.url}</p>
                    <p class="text-xs">
                      {new Date(install.timestamp).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    {#if install.success}
                      <span class="text-green-600 dark:text-green-400">✓</span>
                    {:else}
                      <span class="text-red-600 dark:text-red-400">✗</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* Additional custom styles if needed */
</style>
