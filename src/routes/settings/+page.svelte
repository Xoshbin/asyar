<script lang="ts">
    import { onMount } from 'svelte';
    import { Button, Card, Toggle, ShortcutRecorder } from '../../components';
    import { 
      getShortcutConfig, 
      updateShortcut, 
      getAvailableModifiers, 
      getAvailableKeys 
    } from '../../services/shortcutManager';
    import { goto } from '$app/navigation';
    
    // Settings state
    let shortcutConfig = { modifier: 'Super', key: 'K' };
    let selectedModifier = 'Super';
    let selectedKey = 'K';
    let isSaving = false;
    let saveMessage = '';
    let saveError = false;
    let startAtLogin = false;
    let activeTab = 'general';
    let windowWidth = 800;
    let windowHeight = 600;
    let selectedTheme = 'system';
  
    // Get available options
    const modifiers = getAvailableModifiers();
    const keys = getAvailableKeys();
  
    onMount(async () => {
      try {
        // Load current shortcut config
        shortcutConfig = await getShortcutConfig();
        selectedModifier = shortcutConfig.modifier;
        selectedKey = shortcutConfig.key;
      } catch (error) {
        console.error('Failed to load shortcut configuration:', error);
        saveError = true;
        saveMessage = 'Failed to load settings';
      }
      
      // Apply theme class to body based on user preference
      document.body.classList.add('settings-page');
    });
  
    async function saveSettings() {
      isSaving = true;
      saveMessage = '';
      saveError = false;
  
      try {
        // Update shortcut configuration
        const success = await updateShortcut(selectedModifier, selectedKey);
        
        if (success) {
          saveMessage = 'Settings saved successfully';
          // Update local config
          shortcutConfig = { modifier: selectedModifier, key: selectedKey };
        } else {
          throw new Error('Failed to update shortcut');
        }
      } catch (error) {
        console.error('Error saving settings:', error);
        saveError = true;
        saveMessage = 'Failed to save settings';
      } finally {
        isSaving = false;
        // Clear message after 3 seconds
        setTimeout(() => {
          saveMessage = '';
        }, 3000);
      }
    }
  
    function goBack() {
      goto('/');
    }
    
    function updateWindowWidth(event: { target: { value: number; }; }) {
      windowWidth = event.target.value;
    }
    
    function updateWindowHeight(event: { target: { value: number; }; }) {
      windowHeight = event.target.value;
    }
    
    function updateTheme(theme: string) {
      selectedTheme = theme;
    }
  </script>
  
  <svelte:head>
    <title>Asyar Settings</title>
  </svelte:head>
  
  <div class="container mx-auto p-6 max-w-5xl">
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
              <Toggle bind:checked={startAtLogin} />
            </div>
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
                  on:click={saveSettings} 
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
                    on:change={() => updateTheme('system')}  
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
                    on:change={() => updateTheme('light')}
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
                    on:change={() => updateTheme('dark')}
                    class="sr-only"
                  >
                  <div class="text-sm mt-1 text-[var(--text-secondary)]">Dark</div>
                </label>
              </div>
            </div>
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
  
  <style>
    /* Additional styling specific to the settings page */
    :global(body) {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      @apply overflow-y-auto;
    }
  
  </style>
