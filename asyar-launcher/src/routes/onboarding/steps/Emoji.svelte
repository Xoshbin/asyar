<script lang="ts">
  import { t } from '../../../services/i18n';
  import { onMount } from 'svelte';
  import { Card, Button, ExpansionDemo } from '../../../components';
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

<Card>
  <div class="step">
    <p class="step__kicker">{t('onboarding.emoji_kicker')}</p>
    <h1 class="step__title">
      {t('onboarding.emoji_title_pre')} <span class="onb-hl">{t('onboarding.emoji_title_hl')}</span>
    </h1>
    <p class="step__lede">
      {t('onboarding.emoji_desc_pre')} <code>:party:</code>
      {t('onboarding.emoji_desc_post')}
    </p>

    <div class="step__setup">
      <span class="step__label"
        >{t('onboarding.step_num', { n: 1, label: t('onboarding.install') })}</span
      >
      <Button onclick={doInstall} disabled={installing || installed}>
        {installed
          ? t('onboarding.emoji_installed')
          : installing
            ? t('common.installing')
            : t('onboarding.emoji_install_btn')}
      </Button>
      {#if error}<p class="step__error">{error}</p>{/if}
      <span class="step__label"
        >{t('onboarding.step_num', { n: 2, label: t('onboarding.permission') })}</span
      >
      <AccessibilityGate bind:granted={axGranted} />
    </div>

    <ExpansionDemo trigger=":party:" result="🎉" note={t('onboarding.emoji_note')} />
  </div>
</Card>

<style>
  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .step__kicker {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--asyar-brand);
  }
  .step__title {
    margin: 0;
    font-size: var(--font-size-display);
    font-weight: 600;
    letter-spacing: -0.5px;
    color: var(--text-primary);
  }
  .step__lede {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-xl);
    line-height: 1.6;
  }
  .step__lede code {
    background: var(--bg-tertiary);
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    padding: 0 var(--space-2);
  }
  .step__setup {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .step__label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .step__error {
    margin: var(--space-2) 0 0;
    color: var(--accent-danger);
    font-size: var(--font-size-md);
  }
</style>
