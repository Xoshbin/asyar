<script lang="ts">
    import { onMount } from 'svelte';
    import { Button, Card, Toggle, ShortcutRecorder, ConfirmDialog } from '../../components';
    import { getAvailableModifiers, getAvailableKeys, updateShortcut } from '../../utils/shortcutManager';
    import { goto } from '$app/navigation';
    import { settingsService, type AppSettings, settings as settingsStore } from '../../services/settingsService';
    import { LogService } from '../../services/logService';
    import extensionManager, { extensionUninstallInProgress } from '../../services/extensionManager';
    import { get } from 'svelte/store';
    
    // Define interface for extension items with enabled status
    interface ExtensionItem {
      title: string;
      subtitle?: string;
      keywords?: string;
      type?: string;
      iconUrl?: string;
      version?: string;
      action?: () => void;
      enabled?: boolean;
      id?: string;
    }
    
    // Initialize with default settings first
    const DEFAULT_SETTINGS: AppSettings = {
      general: {
        startAtLogin: false,
        showDockIcon: true,
      },
      search: {
        searchApplications: true,
        searchSystemPreferences: true,
        fuzzySearch: true,
      },
      shortcut: {
        modifier: "Super",
        key: "K",
      },
      appearance: {
        theme: "system" as const,
        windowWidth: 800,
        windowHeight: 600,
      },
      extensions: {
        enabled: {}
      }
    };
    
    // Settings state
    let settings: AppSettings = DEFAULT_SETTINGS;
    let selectedModifier = 'Super';
    let selectedKey = 'K';
    let isSaving = false;
    let saveMessage = '';
    let saveError = false;
    let activeTab = 'general';
    let selectedTheme = 'system';
    let isLoading = true;
    let initError = '';
    
    // Extensions state
    let extensions: ExtensionItem[] = [];
    let isLoadingExtensions = false;
    let extensionError = '';
    let togglingExtension: string | null = null;

    // Uninstall extension state
    let uninstallDialogOpen = false;
    let extensionToUninstall: ExtensionItem | null = null;

    // Get available options for shortcut keys
    const modifiers = getAvailableModifiers();
    const keys = getAvailableKeys();
  
    onMount(async () => {
      try {
        // LogService.info("Settings page mounted");
        
        // Initialize with defaults first to avoid blank UI
        settings = { ...DEFAULT_SETTINGS };
        selectedModifier = settings.shortcut.modifier;
        selectedKey = settings.shortcut.key;
        selectedTheme = settings.appearance.theme;
        
        // Initialize settings service
        // LogService.info("Initializing settings service");
        const success = await settingsService.init();
        
        if (!success) {
          LogService.error("Settings initialization failed");
          initError = "Settings initialization failed. Using defaults.";
          // Continue with defaults rather than failing completely
        } else {
          // Get the initialized settings
          settings = settingsService.getSettings();
          
          // Set local state from settings
          selectedModifier = settings.shortcut.modifier;
          selectedKey = settings.shortcut.key;
          selectedTheme = settings.appearance.theme;
          
          // LogService.info("Settings loaded successfully");
        }
      } catch (error) {
        LogService.error(`Failed to load settings: ${error}`);
        initError = 'Failed to load settings. Using defaults.';
        // Continue with defaults
      } finally {
        isLoading = false;
        // Apply theme class to body
        document.body.classList.add('settings-page');
        
        // Load extensions data
        await loadExtensions();
      }
    });
    
    // Load extensions data - updated to use getAllExtensionsWithState
    async function loadExtensions() {
      isLoadingExtensions = true;
      extensionError = '';
      
      try {
        // LogService.info("Loading extensions for settings page");
        
        // Get all extensions with their enabled status
        extensions = await extensionManager.getAllExtensionsWithState();
        
        // LogService.info(`Loaded ${extensions.length} extensions`);
        // LogService.debug(`Extensions data: ${JSON.stringify(extensions)}`);
      } catch (error) {
        LogService.error(`Failed to load extensions: ${error}`);
        extensionError = 'Failed to load extensions information.';
        extensions = [];
      } finally {
        isLoadingExtensions = false;
      }
    }
    
    // Toggle extension enabled/disabled state
    async function toggleExtension(extension: ExtensionItem) {
      if (togglingExtension === extension.title) return; // Prevent multiple clicks
      
      togglingExtension = extension.title;
      const newState = !extension.enabled;
      
      try {
        const success = await extensionManager.toggleExtensionState(extension.title, newState);
        
        if (success) {
          // Update the local state
          extension.enabled = newState;
          // LogService.info(`Extension ${extension.title} ${newState ? 'enabled' : 'disabled'}`);
          
          // Show message that restart is needed
          saveMessage = 'Extension settings updated. Restart Asyar to apply changes.';
          saveError = false;
          
          setTimeout(() => {
            saveMessage = '';
          }, 5000);
        } else {
          throw new Error('Failed to update extension state');
        }
      } catch (error) {
        LogService.error(`Failed to toggle extension ${extension.title}: ${error}`);
        saveMessage = 'Failed to update extension settings.';
        saveError = true;
        
        setTimeout(() => {
          saveMessage = '';
          saveError = false; 
        }, 3000);
      } finally {
        togglingExtension = null;
      }
    }

    // Handle uninstall action
    function openUninstallDialog(extension: ExtensionItem) {
      extensionToUninstall = extension;
      uninstallDialogOpen = true;
    }
    
    async function uninstallExtension() {
      if (!extensionToUninstall) return;
      
      try {
        const extensionName = extensionToUninstall.title;
        const extensionId = extensionToUninstall.id;
        
        if (!extensionId) {
          throw new Error("Extension ID not available");
        }
        
        const success = await extensionManager.uninstallExtension(extensionId, extensionName);
        
        if (success) {
          // Remove from local extensions list
          extensions = extensions.filter(ext => ext.title !== extensionName);
          
          saveMessage = `Extension "${extensionName}" uninstalled successfully.`;
          saveError = false;
        } else {
          throw new Error("Failed to uninstall extension");
        }
      } catch (error) {
        LogService.error(`Error uninstalling extension: ${error}`);
        saveMessage = 'Failed to uninstall extension.';
        saveError = true;
      } finally {
        setTimeout(() => {
          saveMessage = '';
          saveError = false;
        }, 3000);
        
        extensionToUninstall = null;
      }
    }
    
    // Subscribe to settings changes
    const unsubscribe = settingsStore.subscribe(newSettings => {
      if (newSettings) {
        settings = newSettings;
      }
    });
  
    async function saveShortcutSettings() {
      isSaving = true;
      saveMessage = '';
      saveError = false;
  
      try {
        // Update shortcut configuration
        const success = await updateShortcut(selectedModifier, selectedKey);
        
        if (success) {
          saveMessage = 'Shortcut saved successfully';
        } else {
          throw new Error('Failed to update shortcut');
        }
      } catch (error) {
        LogService.error(`Error saving shortcut: ${error}`);
        saveError = true;
        saveMessage = 'Failed to save shortcut';
      } finally {
        isSaving = false;
        // Clear message after 3 seconds
        setTimeout(() => {
          saveMessage = '';
        }, 3000);
      }
    }
    
    async function handleAutostartToggle() {
      try {
        const success = await settingsService.updateSettings('general', {
          startAtLogin: !settings.general.startAtLogin
        });
        
        if (!success) {
          throw new Error('Failed to update autostart setting');
        }
      } catch (error) {
        LogService.error(`Failed to update autostart setting: ${error}`);
        saveError = true;
        saveMessage = 'Failed to update startup setting';
        
        setTimeout(() => {
          saveMessage = '';
          saveError = false;
        }, 3000);
      }
    }
    
    async function updateThemeSetting(theme: AppSettings['appearance']['theme']) {
      try {
        await settingsService.updateSettings('appearance', { theme });
        selectedTheme = theme;
      } catch (error) {
        LogService.error(`Failed to update theme: `);
        saveError = true;
        saveMessage = 'Failed to update theme';
        
        setTimeout(() => {
          saveMessage = '';
          saveError = false;
        }, 3000);
      }
    }

    function goBack() {
      goto('/');
    }
</script>

<svelte:head>
  <title>Asyar Settings</title>
</svelte:head>

{#if isLoading}
  <div class="flex items-center justify-center h-screen">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--text-primary)] mx-auto mb-4"></div>
      <p class="text-[var(--text-primary)]">Loading settings...</p>
    </div>
  </div>
{:else}
  {#if initError}
    <div class="fixed top-0 left-0 right-0 bg-yellow-500 text-black p-2 text-center">
      ⚠️ {initError}
    </div>
  {/if}
  
  <div class="container mx-auto p-6 max-w-5xl pt-{initError ? '12' : '6'}">
    <div class="flex gap-8">
      <!-- Sidebar Navigation -->
      <aside class="w-56 flex-shrink-0">
        <nav class="sticky top-6 space-y-1">
          <button 
            class="w-full py-3 px-4 text-left rounded-lg font-medium transition-colors {activeTab === 'general' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
            on:click={() => activeTab = 'general'}
          >
            General
          </button>
          <button 
            class="w-full py-3 px-4 text-left rounded-lg font-medium transition-colors {activeTab === 'shortcuts' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
            on:click={() => activeTab = 'shortcuts'}
          >
            Shortcuts
          </button>
          <button 
            class="w-full py-3 px-4 text-left rounded-lg font-medium transition-colors {activeTab === 'appearance' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
            on:click={() => activeTab = 'appearance'}
          >
            Appearance
          </button>
          <!-- New Extensions Tab Button -->
          <button 
            class="w-full py-3 px-4 text-left rounded-lg font-medium transition-colors {activeTab === 'extensions' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
            on:click={() => activeTab = 'extensions'}
          >
            Extensions
          </button>
          <button 
            class="w-full py-3 px-4 text-left rounded-lg font-medium transition-colors {activeTab === 'about' ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}"
            on:click={() => activeTab = 'about'}
          >
            About
          </button>
        </nav>
      </aside>
  
      <!-- Main Content -->
      <main class="flex-1 custom-scrollbar space-y-6">
        {#if activeTab === 'general'}
          <Card title="Startup Settings">
            <div class="flex items-center justify-between py-4 border-b border-[var(--border-color)]">
              <div>
                <div class="font-medium text-[var(--text-primary)]">Launch at login</div>
                <div class="mt-1 text-sm text-[var(--text-secondary)]">
                  Automatically start Asyar when you log in to your computer
                </div>
              </div>
              <Toggle 
                checked={settings.general.startAtLogin}
                on:change={handleAutostartToggle}
              />
            </div>
            
            {#if saveError && saveMessage}
              <div class="mt-4 text-sm font-medium text-red-500">
                {saveMessage}
              </div>
            {/if}
          </Card>
        {/if}
  
        {#if activeTab === 'shortcuts'}
          <Card title="Global Shortcuts">
            <div class="mb-8">
              <div class="mb-2 font-medium text-[var(--text-primary)]">Asyar activation shortcut</div>
              <div class="text-sm mb-6 text-[var(--text-secondary)]">
                This shortcut will show or hide Asyar from anywhere on your system
              </div>
              
              <div class="mb-6">
                <ShortcutRecorder 
                  bind:modifier={selectedModifier}
                  bind:key={selectedKey}
                  placeholder="Click to set shortcut"
                  disabled={isSaving}
                />
              </div>
              
              <div class="flex items-center">
                <Button 
                  on:click={saveShortcutSettings} 
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Shortcut'}
                </Button>
                
                {#if saveMessage}
                  <div class="ml-4 text-sm font-medium {saveError ? 'text-red-500' : 'text-green-500'}">
                    {saveMessage}
                  </div>
                {/if}
              </div>
            </div>
          </Card>
        {/if}
  
        {#if activeTab === 'appearance'}
          <Card title="Theme Settings">
            <div class="mb-8">
              <div class="mb-3 font-medium text-[var(--text-primary)]">App Theme</div>
              <div class="grid grid-cols-3 gap-6">
                <label class="flex flex-col items-center cursor-pointer">
                  <div class="w-full h-32 rounded-xl border-2 {selectedTheme === 'system' ? 'border-blue-500' : 'border-transparent hover:border-[var(--border-color)]'} bg-gradient-to-r from-[#f8f9fa] to-[#212529] mb-2 flex items-center justify-center shadow-sm overflow-hidden">
                    <div class="bg-white dark:bg-gray-800 w-full h-full flex items-center justify-center">
                      <span class="text-black dark:text-white font-medium">System</span>
                    </div>
                  </div>
                  <input 
                    type="radio" 
                    name="theme" 
                    value="system" 
                    checked={selectedTheme === 'system'}
                    on:change={() => updateThemeSetting('system')}  
                    class="sr-only"
                  >
                  <div class="text-sm mt-1 text-[var(--text-secondary)]">System</div>
                </label>
                
                <label class="flex flex-col items-center cursor-pointer">
                  <div class="w-full h-32 rounded-xl border-2 {selectedTheme === 'light' ? 'border-blue-500' : 'border-transparent hover:border-[var(--border-color)]'} bg-[#f8f9fa] mb-2 flex items-center justify-center shadow-sm overflow-hidden">
                    <span class="text-black font-medium">Light</span>
                  </div>
                  <input 
                    type="radio" 
                    name="theme" 
                    value="light"
                    checked={selectedTheme === 'light'}
                    on:change={() => updateThemeSetting('light')}
                    class="sr-only"
                  >
                  <div class="text-sm mt-1 text-[var(--text-secondary)]">Light</div>
                </label>
                
                <label class="flex flex-col items-center cursor-pointer">
                  <div class="w-full h-32 rounded-xl border-2 {selectedTheme === 'dark' ? 'border-blue-500' : 'border-transparent hover:border-[var(--border-color)]'} bg-[#212529] mb-2 flex items-center justify-center shadow-sm overflow-hidden">
                    <span class="text-white font-medium">Dark</span>
                  </div>
                  <input 
                    type="radio" 
                    name="theme" 
                    value="dark" 
                    checked={selectedTheme === 'dark'}
                    on:change={() => updateThemeSetting('dark')}
                    class="sr-only"
                  >
                  <div class="text-sm mt-1 text-[var(--text-secondary)]">Dark</div>
                </label>
              </div>
            </div>
          </Card>
        {/if}
        
        {#if activeTab === 'extensions'}
          <Card title="Installed Extensions">
            {#if isLoadingExtensions}
              <div class="flex items-center justify-center py-12">
                <div class="text-center">
                  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--text-primary)] mx-auto mb-4"></div>
                  <p class="text-[var(--text-secondary)]">Loading extensions...</p>
                </div>
              </div>
            {:else if extensionError}
              <div class="py-8 text-center">
                <div class="text-red-500 mb-2">⚠️ {extensionError}</div>
                <Button on:click={loadExtensions}>Retry</Button>
              </div>
            {:else if extensions.length === 0}
              <div class="py-12 text-center">
                <p class="text-[var(--text-secondary)] mb-4">No extensions installed</p>
                <p class="text-sm text-[var(--text-tertiary)]">Extensions add new functionality to Asyar</p>
                <!-- Add debug info in development -->
                {#if import.meta.env?.DEV}
                  <p class="mt-4 p-2 bg-yellow-100 text-yellow-800 rounded text-xs">Debug: Extensions array is empty</p>
                {/if}
              </div>
            {:else}
              <!-- Debug info in development -->
              {#if import.meta.env?.DEV}
                <div class="mb-4 p-2 bg-blue-100 text-blue-800 rounded text-xs">
                   {extensions.length} extensions installed
                </div>
              {/if}
              
              {#if saveMessage}
                <div class="mb-4 p-3 rounded {saveError ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
                  {saveMessage}
                </div>
              {/if}
              
              <div class="grid gap-4">
                {#each extensions as extension}
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
                            <div class="text-xs px-2 py-1 bg-[var(--bg-secondary)] rounded text-[var(--text-secondary)]">v{extension.version}</div>
                          {/if}
                        </div>
                        <div class="text-sm text-[var(--text-secondary)] mt-1">{extension.subtitle || "No description available"}</div>
                        {#if extension.type}
                          <div class="mt-2 flex items-center gap-2">
                            <span class="text-xs font-medium px-2 py-0.5 bg-[var(--bg-secondary)] rounded text-[var(--text-tertiary)]">
                              {extension.type}
                            </span>
                          </div>
                        {/if}
                      </div>
                      
                      <!-- Extension actions - now working toggle -->
                      <div class="ml-4 flex flex-col items-end">
                        <div class="flex items-center gap-2">
                          <Toggle 
                            checked={extension.enabled === true}
                            disabled={togglingExtension === extension.title || $extensionUninstallInProgress === extension.id}
                            on:change={() => toggleExtension(extension)}
                          />
                          
                          <!-- Uninstall button -->
                          <button 
                            class="text-xs text-red-500 hover:underline hover:text-red-600"
                            on:click={() => openUninstallDialog(extension)}
                            disabled={$extensionUninstallInProgress === extension.id}
                          >
                            {$extensionUninstallInProgress === extension.id ? 'Uninstalling...' : 'Uninstall'}
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
          </Card>
        {/if}
  
        {#if activeTab === 'about'}
          <Card>
            <div class="flex flex-col items-center justify-center pb-8 mb-8 border-b border-[var(--border-color)]">
              <div class="w-24 h-24 rounded-xl mx-auto mb-4 shadow-xl flex items-center justify-center">
                <img src="/src/resources/images/Square142x142Logo.png" alt="">
              </div>
              <h2 class="text-2xl font-bold mt-4 text-[var(--text-primary)]">Asyar</h2>
              <p class="text-[var(--text-secondary)] mt-2">Version 0.1.0</p>
            </div>
            
            <div class="grid md:grid-cols-2 gap-8">
              <div>
                <h3 class="text-lg font-medium mb-3 text-[var(--text-primary)]">Description</h3>
                <p class="text-[var(--text-secondary)] leading-relaxed">
                  Asyar is a lightweight, keyboard-driven application launcher for macOS.
                  Find and launch applications quickly with just a few keystrokes.
                </p>
              </div>
              
              <div>
                <h3 class="text-lg font-medium mb-3 text-[var(--text-primary)]">Credits</h3>
                <p class="text-[var(--text-secondary)] mb-2">
                  <strong>Created by:</strong> Khoshbin Ali
                </p>
                <p class="text-[var(--text-secondary)] mb-2">
                  <strong>Built with:</strong> Tauri, Rust, Svelte, TypeScript
                </p>
              </div>
            </div>
            
            <div class="flex gap-4 mt-8 pt-6 border-t border-[var(--border-color)]">
              <Button>
                Check for Updates
              </Button>
              <Button>
                View on GitHub
              </Button>
              <div class="grow"></div>
              <Button>
                Privacy Policy
              </Button>
              <Button>
                License
              </Button>
            </div>
          </Card>
        {/if}
      </main>
    </div>
  </div>
{/if}

<!-- Uninstall confirmation dialog -->
<ConfirmDialog
  bind:isOpen={uninstallDialogOpen}
  title="Uninstall Extension"
  message={`Are you sure you want to uninstall "${extensionToUninstall?.title}"? This action cannot be undone.`}
  confirmButtonText="Uninstall"
  isDestructive={true}
  on:confirm={uninstallExtension}
/>
