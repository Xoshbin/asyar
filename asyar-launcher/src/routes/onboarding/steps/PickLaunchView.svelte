<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import { Card, Button, AppearanceThemeSelector, WindowModeSelector } from '../../../components';
  import { advanceStep, goBackStep } from '../stepLogic';
  import { settingsService } from '../../../services/settings/settingsService.svelte';

  const currentTheme = $derived(settingsService.currentSettings.appearance.theme);
  const currentLaunchView = $derived(settingsService.currentSettings.appearance.launchView);

  async function pickTheme(theme: 'light' | 'dark' | 'system') {
    await settingsService.updateSettings('appearance', { theme });
  }

  async function pickLaunchView(launchView: 'default' | 'compact') {
    await settingsService.updateSettings('appearance', { launchView });
    // Cross-window event so the launcher webview's compactSyncService updates
    // its geometry while we're still in onboarding (matches GeneralTab).
    await emit('asyar:launch-view-changed', { launchView });
  }
</script>

<Card>
  <h1>Choose how Asyar looks</h1>
  <p>You can change these any time in Settings.</p>

  <div class="row">
    <div class="row__label">
      <span class="row__title">Appearance</span>
      <span class="row__hint">Light, dark, or follow your system.</span>
    </div>
    <AppearanceThemeSelector value={currentTheme} onchange={pickTheme} />
  </div>

  <div class="row">
    <div class="row__label">
      <span class="row__title">Window mode</span>
      <span class="row__hint">Default shows results panel; Compact is just the search bar.</span>
    </div>
    <WindowModeSelector value={currentLaunchView} onchange={pickLaunchView} />
  </div>

  <div class="actions">
    <Button class="btn-secondary" onclick={goBackStep}>Back</Button>
    <Button onclick={advanceStep}>Continue</Button>
  </div>
</Card>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--separator);
  }
  .row:last-of-type {
    border-bottom: none;
  }
  .row__label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row__title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .row__hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-5);
  }
</style>
