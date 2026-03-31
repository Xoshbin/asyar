<script lang="ts">
  import { SettingsSection } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();
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
