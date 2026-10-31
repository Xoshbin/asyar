<script lang="ts">
  import Badge from '../base/Badge.svelte';
  import Button from '../base/Button.svelte';
  import Input from '../base/Input.svelte';
  import InlineError from '../feedback/InlineError.svelte';
  import WarningBanner from '../feedback/WarningBanner.svelte';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';
  import type { CredentialState } from '../../bindings';

  /**
   * Write-only API key field. The stored key is never shown — not even a mask
   * or its last characters — so the only things it can display are "saved",
   * "needs re-entry" or an empty input.
   */
  let {
    label,
    inputId,
    placeholder,
    state: credState,
    optional = false,
    onSave,
    onRemove,
  }: {
    label: string;
    inputId: string;
    placeholder: string;
    state: CredentialState;
    optional?: boolean;
    onSave: (secret: string) => Promise<void>;
    onRemove: () => Promise<void>;
  } = $props();

  let input = $state('');
  let replacing = $state(false);
  let saving = $state(false);
  let removing = $state(false);
  let error = $state('');

  let canSave = $derived(input.trim().length > 0 && !saving);

  function reset() {
    input = '';
    replacing = false;
    error = '';
  }

  async function save() {
    const secret = input.trim();
    if (!secret || saving) return;
    saving = true;
    error = '';
    try {
      await onSave(secret);
      input = '';
      replacing = false;
    } catch (err) {
      logService.error(`Failed to save credential (${inputId}): ${err}`);
      error = t('settings.ai.key_save_error');
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (removing) return;
    removing = true;
    error = '';
    try {
      await onRemove();
      input = '';
      replacing = false;
    } catch (err) {
      logService.error(`Failed to remove credential (${inputId}): ${err}`);
      error = t('settings.ai.key_remove_error');
    } finally {
      removing = false;
    }
  }
</script>

<div class="cred-field">
  {#if credState === 'configured' && !replacing}
    <span class="cred-label">
      {label}{#if optional}<span class="cred-hint">{t('settings.ai.optional')}</span>{/if}
    </span>
    <div class="cred-configured-row">
      <Badge variant="success" text={t('settings.ai.key_saved')} />
      <div class="cred-actions">
        <Button
          size="small"
          onclick={() => {
            input = '';
            error = '';
            replacing = true;
          }}
        >
          {t('settings.ai.replace_key')}
        </Button>
        <Button size="small" class="btn-danger" onclick={remove} disabled={removing}>
          {t('settings.ai.remove_key')}
        </Button>
      </div>
    </div>
  {:else}
    <label class="cred-label" for={inputId}>
      {label}{#if optional}<span class="cred-hint">{t('settings.ai.optional')}</span>{/if}
    </label>
    {#if credState === 'needsReentry'}
      <div class="cred-warning-wrap">
        <WarningBanner>{t('settings.ai.key_reentry_warning')}</WarningBanner>
      </div>
    {/if}
    <div class="cred-input-row">
      <Input
        unstyled
        textIntent="exact"
        class="cred-input"
        id={inputId}
        type="password"
        {placeholder}
        autocomplete="off"
        value={input}
        oninput={(e) => {
          input = (e.currentTarget as HTMLInputElement).value;
        }}
      />
      <div class="cred-actions">
        <Button size="small" onclick={save} disabled={!canSave}>
          {saving ? t('settings.ai.saving') : t('settings.ai.save_key')}
        </Button>
        {#if replacing}
          <Button size="small" onclick={reset}>{t('settings.ai.cancel')}</Button>
        {/if}
      </div>
    </div>
  {/if}
  {#if error}
    <InlineError message={error} />
  {/if}
</div>

<style>
  .cred-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .cred-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .cred-hint {
    color: var(--text-tertiary);
    font-weight: 400;
    margin-left: var(--space-1);
  }

  .cred-configured-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) 0;
  }

  .cred-input-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .cred-input-row :global(.cred-input) {
    flex: 1;
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--transition-smooth);
  }

  .cred-input-row :global(.cred-input:focus) {
    outline: none;
    border-color: var(--accent-primary);
  }

  .cred-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .cred-actions :global(.btn-danger) {
    color: var(--accent-danger);
  }

  .cred-actions :global(.btn-danger:hover) {
    background-color: color-mix(in srgb, var(--accent-danger) 10%, transparent);
    border-color: var(--accent-danger);
  }

  .cred-warning-wrap {
    margin-bottom: var(--space-2);
  }
</style>
