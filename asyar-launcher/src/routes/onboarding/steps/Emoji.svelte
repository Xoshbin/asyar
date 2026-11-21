<script lang="ts">
  import { t } from '../../../services/i18n';
  import { onMount } from 'svelte';
  import { Button } from '../../../components';
  import { advanceStep } from '../stepLogic';
  import AccessibilityGate from './AccessibilityGate.svelte';
  import { installEmoji, EMOJI_ID } from './emojiSetup';
  import { onboardingNav } from '../onboardingNav.svelte';
  import { listInstalledExtensions } from '../../../lib/ipc/commands';
  import { isEmojiInstalled } from '../../../lib/installedExtensions';
  import { appListen } from '../../../lib/ipc/bridgeEvents';

  let installed = $state(false);
  let installing = $state(false);
  let axGranted = $state(false);
  let error = $state('');

  $effect(() => {
    onboardingNav.set({
      primaryLabel: installed ? t('onboarding.continue') : t('onboarding.skip'),
      onPrimary: advanceStep,
    });
  });

  async function checkInstalled() {
    try {
      const paths = await listInstalledExtensions();
      if (isEmojiInstalled(paths, EMOJI_ID)) {
        installed = true;
      }
    } catch {}
  }

  async function doInstall() {
    installing = true;
    error = '';
    try {
      installed = await installEmoji();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      installing = false;
    }
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    void checkInstalled();

    window.addEventListener('store-extension-installed', checkInstalled);
    window.addEventListener('store-extension-uninstalled', checkInstalled);

    try {
      void appListen('extensions_updated', checkInstalled).then((fn) => {
        unlisten = fn;
      });
    } catch {}

    return () => {
      window.removeEventListener('store-extension-installed', checkInstalled);
      window.removeEventListener('store-extension-uninstalled', checkInstalled);
      if (unlisten) unlisten();
    };
  });
</script>

<div class="emoji">
  <h1 class="emoji__title">
    {t('onboarding.emoji_title_pre')} <span class="onb-hl">{t('onboarding.emoji_title_hl')}</span>
  </h1>

  <div class="emoji__demo" aria-hidden="true">
    <code class="emoji__code">:party:</code>
    <span class="emoji__arrow">→</span>
    <span class="emoji__result">🎉</span>
  </div>

  <Button onclick={doInstall} disabled={installing || installed}>
    {installed
      ? t('onboarding.emoji_installed')
      : installing
        ? t('common.installing')
        : t('onboarding.emoji_install_btn')}
  </Button>
  {#if error}<p class="emoji__error">{error}</p>{/if}
  <AccessibilityGate bind:granted={axGranted} />
</div>

<style>
  .emoji {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-5);
  }
  .emoji__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .emoji__demo {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--font-size-xl);
  }
  .emoji__code {
    padding: var(--space-1) var(--space-3);
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    color: var(--text-primary);
  }
  .emoji__arrow {
    color: var(--text-tertiary);
  }
  .emoji__result {
    font-size: var(--font-size-display);
    animation: emoji-pop var(--dur-emerge) var(--ease-settle) 400ms both;
  }
  .emoji__error {
    margin: 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }

  @keyframes emoji-pop {
    from {
      opacity: 0;
      transform: scale(0.4);
    }
  }
</style>
