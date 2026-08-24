<script lang="ts">
  import { SettingsCard, SettingsRow, StatusDot } from '../index';
  import { encryptionService } from '../../services/privacy/encryptionService.svelte';
  import { t } from '../../services/i18n';

  let dot = $derived(
    encryptionService.current.status === 'active'
      ? { color: 'success' as const, label: t('settings.privacy.encryption_active') }
      : encryptionService.current.status === 'fallback'
        ? { color: 'warning' as const, label: t('settings.privacy.encryption_fallback') }
        : { color: 'info' as const, label: t('settings.privacy.encryption_unavailable') },
  );

  let description = $derived(
    encryptionService.current.status === 'active'
      ? t('settings.privacy.encryption_desc_active')
      : encryptionService.current.status === 'fallback'
        ? t('settings.privacy.encryption_desc_fallback')
        : t('settings.privacy.encryption_desc_unavailable'),
  );
</script>

<div class="section-header">{t('settings.privacy.encryption_at_rest')}</div>
<SettingsCard>
  <SettingsRow
    label={t('settings.privacy.encryption_at_rest')}
    description={`Clipboard items, snippet expansions, AI conversations, and encrypted extension preferences are stored as ciphertext on disk. ${description}`}
  >
    {#snippet children()}
      <div class="status-row">
        <StatusDot color={dot.color} />
        <span class="text-body">{dot.label}</span>
      </div>
    {/snippet}
  </SettingsRow>
</SettingsCard>

<style>
  .status-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
