<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Button from '../base/Button.svelte';
  import PermissionList from '../settings/PermissionList.svelte';
  import { fadeIn, popupScale } from '$lib/transitions';
  import type { PermissionConsentRequest } from '../../services/extension/permissionConsentService.svelte';

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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onDecline();
    } else if (event.key === 'Enter') {
      // Let a keyboard-focused control's own activation win — otherwise
      // Enter on a Tab-focused Cancel would accept the permissions.
      const active = document.activeElement;
      if (
        active instanceof HTMLButtonElement ||
        (active instanceof HTMLElement && active.getAttribute('role') === 'button')
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onAccept();
    }
  }

  // Capture phase so this fires before all other keydown handlers.
  onMount(() => {
    window.addEventListener('keydown', handleKeydown, true);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown, true);
  });
</script>

<div
  class="fixed inset-0 dialog-backdrop flex items-center justify-center z-[200]"
  onclick={(e) => e.target === e.currentTarget && onDecline()}
  role="button"
  tabindex="0"
  onkeydown={(event) => (event.key === 'Enter' || event.key === ' ' ? onDecline() : null)}
  transition:fadeIn={{ duration: 150 }}
>
  <div
    class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-md overflow-hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="permission-consent-title"
    transition:popupScale={{ duration: 120 }}
  >
    <div class="p-6">
      <h2
        id="permission-consent-title"
        class="text-xl font-semibold mb-2 text-[var(--text-primary)]"
      >
        {request.extensionName} requests permissions
      </h2>
      <p class="text-[var(--text-secondary)] text-sm mb-4">{subtitle}</p>

      <div class="max-h-72 overflow-y-auto mb-6 pr-1">
        <PermissionList permissions={request.permissions} permissionArgs={request.permissionArgs} />
      </div>

      <div class="flex justify-end gap-3">
        <Button onclick={onDecline}>Cancel</Button>
        <Button onclick={onAccept} class="btn-consent-primary">Allow</Button>
      </div>
    </div>
  </div>
</div>

<style>
  .dialog-backdrop {
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
  }

  :global(html[data-platform='linux']) .dialog-backdrop {
    backdrop-filter: none;
    background: rgba(0, 0, 0, 0.6);
  }

  :global(.btn-consent-primary) {
    background: var(--accent-primary) !important;
    color: white !important;
    border: none !important;
  }

  :global(.btn-consent-primary:hover) {
    opacity: 0.9;
  }
</style>
