<script lang="ts">
  import { emit } from '@tauri-apps/api/event';
  import { Card, AppearanceThemeSelector, WindowModeSelector } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { onboardingNav } from '../onboardingNav.svelte';

  $effect(() => {
    onboardingNav.set({ showBack: false, primaryLabel: 'Start the tour', onPrimary: advanceStep })
  })

  const currentTheme = $derived(settingsService.currentSettings.appearance.theme);
  const currentLaunchView = $derived(settingsService.currentSettings.appearance.launchView);

  async function pickTheme(theme: 'light' | 'dark' | 'system') {
    await settingsService.updateSettings('appearance', { theme });
  }

  async function pickLaunchView(launchView: 'default' | 'compact') {
    await settingsService.updateSettings('appearance', { launchView });
    await emit('asyar:launch-view-changed', { launchView });
  }
</script>

<Card>
  <div class="welcome">
    <p class="welcome__kicker">Welcome</p>
    <h1 class="welcome__title">Meet Asyar — your keyboard-first <span class="onb-hl">command center</span></h1>
    <p class="welcome__lede">
      Search apps, do math, ask AI, rewrite text anywhere, expand snippets, and more —
      all from one box. Let's take a 2-minute tour and set you up.
    </p>

    <div class="welcome__row">
      <div class="welcome__row-label">
        <span class="welcome__row-title">Appearance</span>
        <span class="welcome__row-hint">Light, dark, or follow your system.</span>
      </div>
      <AppearanceThemeSelector value={currentTheme} onchange={pickTheme} />
    </div>
    <div class="welcome__row">
      <div class="welcome__row-label">
        <span class="welcome__row-title">Window mode</span>
        <span class="welcome__row-hint">Default shows results panel; Compact is just the search bar.</span>
      </div>
      <WindowModeSelector value={currentLaunchView} onchange={pickLaunchView} />
    </div>

  </div>
</Card>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .welcome__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
  }
  .welcome__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .welcome__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }
  .welcome__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-5);
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--separator);
  }
  .welcome__row:last-of-type {
    border-bottom: none;
  }
  .welcome__row-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .welcome__row-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }
  .welcome__row-hint {
    font-size: var(--font-size-md);
    color: var(--text-secondary);
  }
</style>
