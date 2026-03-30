<script lang="ts">
  import { SettingsSection, SettingsRow, Toggle } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();
</script>

<SettingsSection title="Startup Settings">
  <SettingsRow 
    label="Launch at login" 
    description="Automatically start Asyar when you log in to your computer"
  >
    <Toggle 
      checked={handler.settings.general.startAtLogin}
      onchange={() => handler.handleAutostartToggle()}
    />
  </SettingsRow>

  <SettingsRow 
    label="Include extension results in search" 
  >
    <!-- Since SettingsRow doesn't support custom description snippets, we put the extra info in children -->
    <div class="flex items-center gap-4">
      <div class="text-right">
        <div class="text-sm text-[var(--text-tertiary)] italic flex items-center justify-end gap-1">
          <span style="color: var(--accent-warning)">⚠️</span>
          Allow your installed extensions to show results in the search bar.
        </div>
        <div class="mt-1 text-xs text-[var(--text-secondary)]">
          Note: Enabling this feature may increase memory usage and slightly slow down search as Asyar queries your extensions for results.
        </div>
      </div>
      <Toggle 
        checked={handler.settings.search.enableExtensionSearch}
        onchange={() => handler.handleExtensionSearchToggle()}
      />
    </div>
  </SettingsRow>

  <SettingsRow 
    label="Escape key behavior in views" 
    description="Choose what happens when you press Escape while a view is open"
  >
    <div class="space-y-4 py-2">
      <label class="flex items-start cursor-pointer">
        <input 
          type="radio" 
          name="escapeBehavior" 
          value="close-window" 
          checked={handler.settings.general.escapeInViewBehavior === 'close-window' || !handler.settings.general.escapeInViewBehavior}
          onchange={() => handler.updateEscapeBehavior('close-window')}
          class="mt-1 mr-3"
        >
        <div>
          <div class="font-medium text-[var(--text-primary)]">Close launcher</div>
          <div class="text-sm text-[var(--text-secondary)] mt-0.5">Pressing Escape always closes the launcher (default)</div>
        </div>
      </label>
      
      <label class="flex items-start cursor-pointer">
        <input 
          type="radio" 
          name="escapeBehavior" 
          value="go-back" 
          checked={handler.settings.general.escapeInViewBehavior === 'go-back'}
          onchange={() => handler.updateEscapeBehavior('go-back')}
          class="mt-1 mr-3"
        >
        <div>
          <div class="font-medium text-[var(--text-primary)]">Go back</div>
          <div class="text-sm text-[var(--text-secondary)] mt-0.5">Pressing Escape while a view is open navigates back instead of closing the launcher</div>
        </div>
      </label>
    </div>
  </SettingsRow>
  
  {#if handler.saveError && handler.saveMessage}
    <div class="mt-4 pb-4 text-sm font-medium px-6" style="color: var(--accent-danger)">
      {handler.saveMessage}
    </div>
  {/if}
</SettingsSection>

<SettingsSection title="Extension Settings">
  <SettingsRow 
    label="Calculator: Currency Refresh Interval" 
    description="How often to update exchange rates in the background (hours)"
  >
    <div class="flex items-center gap-4">
      <input 
        type="range" 
        min="1" 
        max="24" 
        step="1"
        value={handler.settings.calculator?.refreshInterval || 6}
        oninput={(e) => handler.updateCalculatorRefreshInterval(parseInt(e.currentTarget.value))}
        class="w-32 h-1.5 rounded-lg appearance-none cursor-pointer bg-[var(--bg-tertiary)]"
        style="accent-color: var(--accent-primary)"
      />
      <span class="text-sm font-mono w-8 text-right">{handler.settings.calculator?.refreshInterval || 6}h</span>
    </div>
  </SettingsRow>
</SettingsSection>
