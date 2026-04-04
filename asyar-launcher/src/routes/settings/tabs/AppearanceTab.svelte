<script lang="ts">
  import { onMount } from 'svelte';
  import { SettingsSection } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { applyTheme, removeTheme } from '../../../services/theme/themeService';
  import { discoverExtensions } from '../../../lib/ipc/commands';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { emit } from '@tauri-apps/api/event';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let themeExtensions = $state<Array<{ id: string; name: string; author?: string; version: string }>>([]);
  let activeThemeId = $state<string | null>(null);

  onMount(async () => {
    try {
      const records = await discoverExtensions();
      themeExtensions = records
        .filter((r: any) => r.manifest.type === 'theme' && r.enabled)
        .map((r: any) => ({
          id: r.manifest.id,
          name: r.manifest.name,
          author: r.manifest.author ?? undefined,
          version: r.manifest.version,
        }));
      activeThemeId = handler.settings?.appearance?.activeTheme ?? null;
    } catch (e) {
      console.error('Failed to load theme extensions:', e);
    }
  });

  async function selectTheme(themeId: string | null) {
    try {
      if (themeId) {
        await applyTheme(themeId);
      } else {
        removeTheme();
      }
      activeThemeId = themeId;
      await settingsService.updateSettings('appearance', { activeTheme: themeId });
      await emit('asyar:theme-changed', { themeId });
    } catch (error) {
      console.error('Failed to apply theme:', error);
    }
  }
</script>

<SettingsSection title="Theme Settings">
  <div class="mb-8 p-6">
    <div class="mb-3 font-medium text-[var(--text-primary)]">App Theme</div>
    <div class="grid grid-cols-3 gap-6">
      <label class="flex flex-col items-center cursor-pointer">
        <div class="w-full h-32 rounded-xl border-2 {handler.selectedTheme === 'system' ? 'border-[var(--accent-primary)]' : 'border-transparent hover:border-[var(--border-color)]'} bg-gradient-to-r from-[#f8f9fa] to-[#212529] mb-2 flex items-center justify-center shadow-sm overflow-hidden">
          <div class="w-full h-full flex items-center justify-center" style="background: linear-gradient(to right, #f8f9fa, #212529);">
            <span class="font-medium" style="color: var(--text-primary)">System</span>
          </div>
        </div>
        <input 
          type="radio" 
          name="theme" 
          value="system" 
          checked={handler.selectedTheme === 'system'}
          onchange={() => handler.updateThemeSetting('system')}  
          class="sr-only"
        >
        <div class="text-sm mt-1 text-[var(--text-secondary)]">System</div>
      </label>
      
      <label class="flex flex-col items-center cursor-pointer">
        <div class="w-full h-32 rounded-xl border-2 {handler.selectedTheme === 'light' ? 'border-[var(--accent-primary)]' : 'border-transparent hover:border-[var(--border-color)]'} mb-2 flex items-center justify-center shadow-sm overflow-hidden" style="background: #f8f9fa;">
          <span class="font-medium" style="color: #212529;">Light</span>
        </div>
        <input 
          type="radio" 
          name="theme" 
          value="light"
          checked={handler.selectedTheme === 'light'}
          onchange={() => handler.updateThemeSetting('light')}
          class="sr-only"
        >
        <div class="text-sm mt-1 text-[var(--text-secondary)]">Light</div>
      </label>
      
      <label class="flex flex-col items-center cursor-pointer">
        <div class="w-full h-32 rounded-xl border-2 {handler.selectedTheme === 'dark' ? 'border-[var(--accent-primary)]' : 'border-transparent hover:border-[var(--border-color)]'} mb-2 flex items-center justify-center shadow-sm overflow-hidden" style="background: #212529;">
          <span class="font-medium" style="color: #f8f9fa;">Dark</span>
        </div>
        <input 
          type="radio" 
          name="theme" 
          value="dark" 
          checked={handler.selectedTheme === 'dark'}
          onchange={() => handler.updateThemeSetting('dark')}
          class="sr-only"
        >
        <div class="text-sm mt-1 text-[var(--text-secondary)]">Dark</div>
      </label>
    </div>
  </div>
</SettingsSection>

{#if themeExtensions.length > 0}
<SettingsSection title="Custom Themes">
  <div class="p-6">
    <div class="grid gap-3">
      <label class="flex items-center p-3 rounded-lg cursor-pointer border-2 {activeThemeId === null ? 'border-[var(--accent-primary)]' : 'border-transparent hover:border-[var(--border-color)]'}" style="background: var(--bg-secondary);">
        <input type="radio" name="custom-theme" checked={activeThemeId === null} onchange={() => selectTheme(null)} class="sr-only">
        <div>
          <div class="font-medium text-sm text-[var(--text-primary)]">Default</div>
          <div class="text-xs text-[var(--text-secondary)]">Built-in Asyar theme</div>
        </div>
      </label>

      {#each themeExtensions as theme}
        <label class="flex items-center p-3 rounded-lg cursor-pointer border-2 {activeThemeId === theme.id ? 'border-[var(--accent-primary)]' : 'border-transparent hover:border-[var(--border-color)]'}" style="background: var(--bg-secondary);">
          <input type="radio" name="custom-theme" checked={activeThemeId === theme.id} onchange={() => selectTheme(theme.id)} class="sr-only">
          <div class="flex-1">
            <div class="font-medium text-sm text-[var(--text-primary)]">{theme.name}</div>
            <div class="text-xs text-[var(--text-secondary)]">
              {#if theme.author}{theme.author} &middot; {/if}v{theme.version}
            </div>
          </div>
        </label>
      {/each}
    </div>
  </div>
</SettingsSection>
{/if}
