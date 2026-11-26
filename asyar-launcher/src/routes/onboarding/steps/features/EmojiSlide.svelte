<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../services/i18n';
  import { Button } from '../../../../components';
  import { listInstalledExtensions } from '../../../../lib/ipc/commands';
  import { isEmojiInstalled } from '../../../../lib/installedExtensions';
  import { EMOJI_ID, installEmoji } from '../emojiSetup';
  import ExpansionField from './ExpansionField.svelte';

  let installed = $state(false);
  let installing = $state(false);
  let error = $state('');

  onMount(async () => {
    installed = isEmojiInstalled((await listInstalledExtensions()) ?? [], EMOJI_ID);
  });

  async function install() {
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
</script>

<ExpansionField placeholder={t('onboarding.tour.emoji_placeholder')} />
<div class="emoji-slide__footer">
  {#if installed}
    <span class="emoji-slide__hint">{t('onboarding.tour.emoji_installed')}</span>
  {:else}
    <Button onclick={install} disabled={installing}>
      {installing ? t('onboarding.setting_up') : t('onboarding.tour.emoji_install')}
    </Button>
  {/if}
  {#if error}<p class="emoji-slide__error">{error}</p>{/if}
</div>

<style>
  .emoji-slide__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--separator);
  }
  .emoji-slide__hint {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .emoji-slide__error {
    margin: 0;
    color: var(--accent-danger);
    font-size: var(--font-size-sm);
  }
</style>
