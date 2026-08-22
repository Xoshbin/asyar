<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import Button from '../base/Button.svelte';
  import PermissionList from '../settings/PermissionList.svelte';
  import RuntimeDownloadList from '../settings/RuntimeDownloadList.svelte';
  import type { PermissionConsentRequest } from '../../services/extension/permissionConsentService.svelte';
  import { t } from '../../services/i18n';

  let { request, onAccept, onDecline } = $props<{
    request: PermissionConsentRequest;
    onAccept: () => void;
    onDecline: () => void;
  }>();

  const subtitle = $derived.by(() => {
    switch (request.reason) {
      case 'install':
        return 'Installing it grants the following permissions:';
      case 'enable':
        return 'Enabling it grants the following permissions:';
      case 'update':
        return 'An update changed the permissions it requests:';
      case 'review':
        return 'Its requested permissions have changed and need your review:';
    }
  });
</script>

<Modal isOpen={true} labelledBy="permission-consent-title" onEscape={onDecline} onEnter={onAccept}>
  {#snippet children()}
    <h2 id="permission-consent-title" class="text-xl font-semibold mb-2 text-[var(--text-primary)]">
      {request.extensionName} requests permissions
    </h2>
    <p class="text-[var(--text-secondary)] text-sm mb-4">{subtitle}</p>

    <div class="max-h-72 overflow-y-auto pr-1 custom-scrollbar">
      <PermissionList permissions={request.permissions} permissionArgs={request.permissionArgs} />
      <RuntimeDownloadList runtimes={request.runtimeDownloads ?? []} />
    </div>
  {/snippet}
  {#snippet actions()}
    <Button onclick={onDecline}>{t('common.cancel')}</Button>
    <Button autofocus onclick={onAccept} class="btn-consent-primary">{t('common.allow')}</Button>
  {/snippet}
</Modal>

<style>
  :global(.btn-consent-primary) {
    background: var(--accent-primary-fill) !important;
    color: var(--text-on-accent) !important;
    border: none !important;
  }

  :global(.btn-consent-primary:hover) {
    opacity: 0.9;
  }
</style>
