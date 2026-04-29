<script lang="ts">
  import { onMount } from 'svelte'
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte'
  import { settingsService } from '../../services/settings/settingsService.svelte'
  import { applyTheme } from '../../services/theme/themeService'
  import { logService } from '../../services/log/logService'
  import '../../resources/styles/style.css'

  let { children } = $props()

  onMount(async () => {
    // The launcher webview owns its own settingsService instance; the
    // onboarding webview is a separate webview and must initialize its own
    // copy before any step reads currentSettings (otherwise reads return
    // DEFAULT_SETTINGS regardless of what's on disk).
    try {
      await settingsService.init()
    } catch (err) {
      logService.warn(`[onboarding] settingsService.init failed: ${err}`)
    }

    // If a theme is already active per persisted settings, apply it to this
    // window so the onboarding visually matches the launcher.
    const activeTheme = settingsService.currentSettings.appearance.activeTheme
    if (activeTheme) {
      applyTheme(activeTheme).catch((err) => {
        logService.warn(`[onboarding] applyTheme failed for ${activeTheme}: ${err}`)
      })
    }

    void onboardingService.load()
  })

  function handleClose() {
    void onboardingService.dismiss()
  }
</script>

<div class="onboarding-frame">
  <header class="onboarding-frame__header">
    <button
      type="button"
      class="onboarding-frame__close"
      aria-label="Close"
      onclick={handleClose}
    >
      ✕
    </button>
  </header>
  <main class="onboarding-frame__main">
    {@render children()}
  </main>
</div>

<style>
  /* The Tauri window is transparent so the rounded corners aren't clipped
     by a square OS backing. html/body are reset to transparent and
     overflow:hidden so only the rounded .onboarding-frame is visible. */
  :global(html),
  :global(body) {
    background: transparent;
    overflow: hidden;
  }
  .onboarding-frame {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    /* Fully opaque surface — content does NOT show the desktop through it. */
    background: var(--bg-popup);
    color: var(--text-primary);
    border-radius: var(--radius-xl);
    overflow: hidden;
  }
  .onboarding-frame__header {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-3);
  }
  .onboarding-frame__close {
    background: transparent;
    border: 0;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
  }
  .onboarding-frame__main {
    flex: 1;
    padding: var(--space-6);
    overflow: auto;
  }
</style>
