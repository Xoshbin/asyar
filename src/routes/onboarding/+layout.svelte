<script lang="ts">
  import { onMount } from 'svelte'
  import { platform } from '@tauri-apps/plugin-os'
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte'
  import { settingsService } from '../../services/settings/settingsService.svelte'
  import { applyTheme } from '../../services/theme/themeService'
  import { logService } from '../../services/log/logService'
  import '../../resources/styles/style.css'

  let { children } = $props()

  onMount(async () => {
    // The launcher webview sets data-platform in its own +layout. The
    // onboarding is a separate webview, so platform-conditional CSS
    // (transparent .onboarding-frame on Windows so Acrylic shows through)
    // needs the attribute set here too.
    try {
      const p = await platform()
      document.documentElement.dataset.platform = p
    } catch (err) {
      logService.warn(`[onboarding] platform detection failed: ${err}`)
    }

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
  /* macOS / Linux: the Tauri window is transparent so the CSS-rounded
     `.onboarding-frame` paints the visible surface and the area outside the
     rounded corners shows the desktop. */
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

  /* Windows: DWM paints the system backdrop (Acrylic, with Mica fallback —
     applied in Rust at window creation) and rounds the visible window
     corners natively. The frame uses the shared `--win-acrylic-tint` token
     so the theme reads cleanly over Acrylic regardless of the desktop
     wallpaper behind, and CSS rounding is dropped so it can't disagree with
     the DWM corner radius and leave a halo at the edge. */
  :global(html[data-platform="windows"]) .onboarding-frame,
  :global(html[data-platform="win32"]) .onboarding-frame {
    background: var(--win-acrylic-tint);
    border-radius: 0;
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
