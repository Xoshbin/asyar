<script lang="ts">
  import ConfirmDialog from '../base/ConfirmDialog.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { DIAGNOSTIC_MESSAGES } from '../../services/diagnostics/messages';
  import type { DiagnosticKind } from '../../services/diagnostics/kinds';
  import { t } from '../../services/i18n';

  let isOpen = $derived(feedbackService.current?.severity === 'fatal');
  let title = $derived(t('dialogs.fatal_error.title'));
  let message = $derived.by(() => {
    const c = feedbackService.current;
    if (!c) return '';
    const msgFn = DIAGNOSTIC_MESSAGES[c.kind as DiagnosticKind];
    return msgFn ? msgFn(c.context ?? {}) : (c.developerDetail ?? 'Unknown error');
  });

  function onClose() {
    void feedbackService.dismiss();
  }
</script>

{#if isOpen}
  <ConfirmDialog
    {isOpen}
    {title}
    {message}
    variant="danger"
    confirmButtonText={t('dialogs.fatal_error.restart')}
    cancelButtonText={t('dialogs.fatal_error.dismiss')}
    oncancel={onClose}
    onconfirm={onClose}
  />
{/if}
