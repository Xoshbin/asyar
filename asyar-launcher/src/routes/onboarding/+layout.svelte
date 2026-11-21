<script lang="ts">
  import { onMount } from 'svelte';
  import { i18nService, t } from '../../services/i18n';
  import { platform } from '@tauri-apps/plugin-os';
  import { onboardingService } from '../../services/onboarding/onboardingService.svelte';
  import { settingsService } from '../../services/settings/settingsService.svelte';
  import { applyTheme } from '../../services/theme/themeService';
  import { logService } from '../../services/log/logService';
  import { initProviders } from '../../services/ai/initProviders';
  import { handleOnboardingKeydown } from './onboardingKeydown';
  import { onboardingNav } from './onboardingNav.svelte';
  import '../../resources/styles/style.css';

  // The onboarding window is a separate Tauri webview and does not run the
  // launcher's appInitializer, so AI provider plugins must be registered
  // locally before any AI step reads the provider registry.
  initProviders();

  let { children } = $props();

  onMount(async () => {
    // Separate webview: load the system UI language here too, otherwise the
    // tour always renders in English.
    await i18nService.init();

    // The launcher webview sets data-platform in its own +layout. The
    // onboarding is a separate webview, so platform-conditional CSS
    // (transparent .onboarding-frame on Windows so Acrylic shows through)
    // needs the attribute set here too.
    try {
      const p = await platform();
      document.documentElement.dataset.platform = p;
    } catch (err) {
      logService.warn(`[onboarding] platform detection failed: ${err}`);
    }

    // The launcher webview owns its own settingsService instance; the
    // onboarding webview is a separate webview and must initialize its own
    // copy before any step reads currentSettings (otherwise reads return
    // DEFAULT_SETTINGS regardless of what's on disk).
    try {
      await settingsService.init();
    } catch (err) {
      logService.warn(`[onboarding] settingsService.init failed: ${err}`);
    }

    // If a theme is already active per persisted settings, apply it to this
    // window so the onboarding visually matches the launcher.
    const activeTheme = settingsService.currentSettings.appearance.activeTheme;
    if (activeTheme) {
      applyTheme(activeTheme).catch((err) => {
        logService.warn(`[onboarding] applyTheme failed for ${activeTheme}: ${err}`);
      });
    }

    void onboardingService.load();
  });

  function handleClose() {
    void onboardingService.dismiss();
  }

  // Cmd/Ctrl+W closes the tour; Enter / Cmd+Enter press the footer buttons.
  function handleKeydown(e: KeyboardEvent) {
    const nav = onboardingNav.current;
    handleOnboardingKeydown(e, {
      onClose: handleClose,
      onPrimary: nav.primaryDisabled ? undefined : () => void nav.onPrimary(),
      onSkip: nav.showSkip ? () => void nav.onSkip() : undefined,
    });
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="onboarding-frame">
  <header class="onboarding-frame__header" data-tauri-drag-region>
    <button
      type="button"
      class="onboarding-frame__close"
      aria-label={t('common.close')}
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
    height: 100%;
    background: transparent;
    overflow: hidden;
  }
  .onboarding-frame {
    /* Pin to all four window edges so the opaque surface always fills the
       whole window — a `height: 100vh` + flex chain collapses to content
       height in this transparent WKWebView, letting the desktop show through
       the bottom. `fixed; inset: 0` can't collapse. */
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    /* Fully opaque surface — content does NOT show the desktop through it. */
    /* Fixed brand-moment colours, so they live here rather than in the theme. */
    /* Palette swap: uncomment one block, comment the other. Each block sets
       its colours and the light layers drawn under the shared grain. */
    /* Lila dusk:
    --onb-shadow: #1d1a36;
    --onb-indigo: #5b46c9;
    --onb-violet: #8466e6;
    --onb-lavender: #e4a2e4;
    --onb-light:
      radial-gradient(ellipse 75% 65% at 80% -5%, var(--onb-lavender), transparent 70%),
      radial-gradient(ellipse 90% 55% at 60% 40%, var(--onb-violet), transparent 70%),
      radial-gradient(ellipse 30% 55% at 18% 35%, var(--onb-indigo), transparent 75%),
      radial-gradient(ellipse 25% 30% at 0% 75%, var(--onb-indigo), transparent 75%); */
    /* Graphite spotlight, after the app icon: a beam from the top centre that
       fades as it falls, a bright source, and a pool of light on the floor. */
    --onb-shadow: #111113;
    --onb-light:
      radial-gradient(ellipse 38% 7% at 50% 86%, rgb(255 255 255 / 0.12), transparent 70%),
      linear-gradient(to bottom, transparent 20%, rgb(17 17 19 / 0.75) 95%),
      conic-gradient(
        from 157deg at 50% -4%,
        transparent,
        rgb(255 255 255 / 0.08) 9deg,
        rgb(255 255 255 / 0.08) 37deg,
        transparent 46deg
      ),
      radial-gradient(circle at 50% 0%, rgb(255 255 255 / 0.22), transparent 22%),
      radial-gradient(ellipse 90% 70% at 50% 0%, #26262b, transparent 75%);
    background-color: var(--onb-shadow);
    background-image:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E"),
      var(--onb-light);
    /* Grain overlays the light; the rest blend normally. Spelled out because a
       short list repeats across layers (enough here for 8). */
    background-blend-mode: overlay, normal, normal, normal, normal, normal, normal, normal;
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
  :global(html[data-platform='windows']) .onboarding-frame,
  :global(html[data-platform='win32']) .onboarding-frame {
    background-color: var(--win-acrylic-tint);
    border-radius: 0;
  }

  .onboarding-frame__header {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: var(--z-raised);
    display: flex;
    justify-content: flex-end;
    padding: var(--space-3);
    user-select: none;
    -webkit-user-select: none;
  }
  .onboarding-frame__close {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    cursor: default;
    font-size: var(--font-size-sm);
    width: var(--size-md);
    height: var(--size-md);
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: var(--transition-normal);
  }
  .onboarding-frame__close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .onboarding-frame__main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
  }
</style>
