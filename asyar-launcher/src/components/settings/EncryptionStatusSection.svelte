<script lang="ts">
  import { SettingsSection, SettingsRow, StatusDot } from '../index';
  import { encryptionService } from '../../services/privacy/encryptionService.svelte';

  let dot = $derived(
    encryptionService.current.status === 'active'
      ? { color: 'success' as const, label: 'Active' }
      : encryptionService.current.status === 'fallback'
        ? { color: 'warning' as const, label: 'File-backed (Linux fallback)' }
        : { color: 'info' as const, label: 'Status unavailable' },
  );

  let description = $derived(
    encryptionService.current.status === 'active'
      ? 'Active — your master key is stored in the OS keychain. A stolen disk image alone cannot decrypt your data.'
      : encryptionService.current.status === 'fallback'
        ? 'Falling back to a file-backed key because Secret Service was unavailable. Install gnome-keyring or KWallet for full at-rest protection.'
        : 'The launcher is still booting or the host status command failed.',
  );
</script>

<SettingsSection
  title="Encryption at Rest"
  description="Clipboard items, snippet expansions, AI conversations, and encrypted extension preferences are stored as ciphertext on disk."
>
  <SettingsRow
    label="Status"
    description={description}
    noBorder
  >
    {#snippet children()}
      <div class="status-row">
        <StatusDot color={dot.color} />
        <span class="text-body">{dot.label}</span>
      </div>
    {/snippet}
  </SettingsRow>
</SettingsSection>

<style>
  .status-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
