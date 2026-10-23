<script lang="ts">
  import Modal from '../base/Modal.svelte';
  import Button from '../base/Button.svelte';
  import Input from '../base/Input.svelte';
  import TabGroup from '../base/TabGroup.svelte';
  import LanDeviceBrowser from '../settings/LanDeviceBrowser.svelte';
  import {
    lanHostValidate,
    lanHostsAdd,
    type DiscoveredDevice,
    type LanDevice,
  } from '../../lib/ipc/lanCommands';
  import type { LanPickerRequest } from '../../services/network/lanDevicePickerService.svelte';
  import { t } from '../../services/i18n';

  interface Props {
    request: LanPickerRequest;
    onPicked: (device: LanDevice) => void;
    onCancel: () => void;
  }

  let { request, onPicked, onCancel }: Props = $props();

  let activeTab = $state<'discovered' | 'manual'>('discovered');
  let manualHost = $state('');
  let manualPort = $state('');
  let manualLabel = $state('');
  let validationError = $state('');
  let isValidManual = $state(false);
  let busy = $state(false);
  let generalError = $state('');

  $effect(() => {
    manualHost = request.target?.host ?? '';
    manualPort = request.target ? String(request.target.port) : '';
    manualLabel = request.target?.label ?? '';
  });

  const tabs = $derived([
    { id: 'discovered', label: t('lan_picker.tab_discovered') },
    { id: 'manual', label: t('lan_picker.tab_manual') },
  ]);

  $effect(() => {
    if (request.mode !== 'discover' || activeTab !== 'manual') return;

    const h = manualHost.trim();
    const p = Number(manualPort.trim());

    if (!h || !manualPort.trim()) {
      validationError = '';
      isValidManual = false;
      return;
    }

    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      validationError = t('lan_picker.invalid_endpoint');
      isValidManual = false;
      return;
    }

    const timer = setTimeout(async () => {
      try {
        await lanHostValidate(h, p);
        validationError = '';
        isValidManual = true;
      } catch (cause) {
        validationError = cause instanceof Error ? cause.message : t('lan_picker.invalid_endpoint');
        isValidManual = false;
      }
    }, 200);

    return () => clearTimeout(timer);
  });

  async function handleDiscoveredSelect(device: DiscoveredDevice) {
    busy = true;
    generalError = '';
    try {
      const added = await lanHostsAdd(request.extensionId, device.host, device.port, device.name);
      onPicked({ host: added.host, port: added.port, label: added.label });
    } catch (cause) {
      generalError = cause instanceof Error ? cause.message : 'Failed to allow device.';
    } finally {
      busy = false;
    }
  }

  async function handleManualSubmit() {
    const p = Number(manualPort.trim());
    const h = manualHost.trim();
    if (!h || !Number.isInteger(p) || p < 1 || p > 65535) {
      validationError = t('lan_picker.invalid_endpoint');
      return;
    }
    busy = true;
    generalError = '';
    try {
      await lanHostValidate(h, p);
      const added = await lanHostsAdd(request.extensionId, h, p, manualLabel.trim() || h);
      onPicked({ host: added.host, port: added.port, label: added.label });
    } catch (cause) {
      generalError = cause instanceof Error ? cause.message : 'This endpoint is not allowed.';
    } finally {
      busy = false;
    }
  }

  async function allowDirect() {
    if (!request.target) return;
    busy = true;
    generalError = '';
    try {
      const added = await lanHostsAdd(
        request.extensionId,
        request.target.host,
        request.target.port,
        request.target.label || request.target.host,
      );
      onPicked({ host: added.host, port: added.port, label: added.label });
    } catch (cause) {
      generalError = cause instanceof Error ? cause.message : 'Failed to allow device.';
    } finally {
      busy = false;
    }
  }

  // Granting access is never a keyboard default: an extension can open this
  // dialog at any moment, and an Enter meant for its own view must not approve
  // a device. Direct-mode consent needs a deliberate click on Allow.
  function handleEnter() {
    if (request.mode === 'discover' && activeTab === 'manual' && isValidManual && !busy) {
      handleManualSubmit();
    }
  }
</script>

<Modal isOpen={true} labelledBy="lan-picker-title" onEscape={onCancel} onEnter={handleEnter}>
  {#snippet children()}
    <div class="picker-content">
      <h2 id="lan-picker-title" class="picker-title">
        {t('lan_picker.title', { extensionName: request.extensionName })}
      </h2>
      {#if request.reason}
        <p class="picker-subtitle">{request.reason}</p>
      {/if}

      {#if request.mode === 'direct'}
        <p class="direct-desc">
          {t('lan_picker.direct_subtitle', {
            extensionName: request.extensionName,
            host: request.target?.host ?? '',
            port: request.target?.port ?? '',
          })}
        </p>
        <div class="target-box">
          <span class="target-addr">{request.target?.host}:{request.target?.port}</span>
          {#if request.target?.label}
            <span class="target-label">{request.target.label}</span>
          {/if}
        </div>
      {:else}
        {#if request.allowManualEntry}
          <div class="tab-wrapper">
            <TabGroup {tabs} bind:activeTab variant="underline" />
          </div>
        {/if}

        {#if activeTab === 'discovered'}
          <div class="browser-wrapper">
            <LanDeviceBrowser
              serviceTypes={request.serviceTypes}
              actionLabel={t('lan_picker.allow')}
              onSelect={handleDiscoveredSelect}
            />
          </div>
        {:else if activeTab === 'manual'}
          <div class="fields">
            <Input
              bind:value={manualHost}
              placeholder={t('lan_picker.manual_host')}
              disabled={busy}
            />
            <Input
              bind:value={manualPort}
              type="number"
              placeholder={t('lan_picker.manual_port')}
              disabled={busy}
            />
            <Input
              bind:value={manualLabel}
              placeholder={t('lan_picker.manual_label')}
              disabled={busy}
            />
            {#if validationError}
              <p class="error-msg">{validationError}</p>
            {/if}
          </div>
        {/if}
      {/if}

      {#if generalError}
        <p class="error-msg">{generalError}</p>
      {/if}
    </div>
  {/snippet}

  {#snippet actions()}
    <Button autofocus onclick={onCancel}>{t('lan_picker.cancel')}</Button>
    {#if request.mode === 'direct'}
      <Button onclick={allowDirect} disabled={busy} class="btn-consent-primary">
        {t('lan_picker.allow')}
      </Button>
    {:else if activeTab === 'manual'}
      <Button
        onclick={handleManualSubmit}
        disabled={!isValidManual || busy}
        class="btn-consent-primary"
      >
        {t('lan_picker.allow')}
      </Button>
    {/if}
  {/snippet}
</Modal>

<style>
  .picker-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .picker-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .picker-subtitle {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }
  .direct-desc {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }
  .target-box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    margin-top: var(--space-2);
  }
  .target-addr {
    font-family: var(--font-mono);
    font-size: var(--font-size-md);
    color: var(--text-primary);
    font-weight: 600;
  }
  .target-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .tab-wrapper {
    margin-top: var(--space-1);
    margin-bottom: var(--space-2);
  }
  .browser-wrapper {
    min-height: 180px;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-2);
  }
  .error-msg {
    font-size: var(--font-size-sm);
    color: var(--accent-danger);
    margin: 0;
  }
  :global(.btn-consent-primary) {
    background: var(--accent-primary-fill) !important;
    color: var(--text-on-accent) !important;
    border: none !important;
  }
  :global(.btn-consent-primary:hover) {
    opacity: 0.9;
  }
</style>
