<script lang="ts">
  import ConfirmDialog from '../base/ConfirmDialog.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';

  let isOpen = $derived(diagnosticsService.current?.severity === 'fatal');
  let title = $derived('Asyar encountered a fatal error');
  let message = $derived.by(() => {
    const c = diagnosticsService.current;
    if (!c) return '';
    const t = DIAGNOSTIC_MESSAGES[c.kind as DiagnosticKind];
    return t ? t(c.context ?? {}) : c.developerDetail ?? 'Unknown error';
  });

  function onClose() { diagnosticsService.dismiss(); }
</script>

{#if isOpen}
  <ConfirmDialog
    {isOpen}
    {title}
    {message}
    variant="danger"
    confirmButtonText="Restart"
    cancelButtonText="Dismiss"
    oncancel={onClose}
    onconfirm={onClose}
  />
{/if}
