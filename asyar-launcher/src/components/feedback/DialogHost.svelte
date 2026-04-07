<script lang="ts">
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import ConfirmDialog from '../base/ConfirmDialog.svelte';
</script>

{#if feedbackService.activeDialog}
  {@const dialog = feedbackService.activeDialog}
  <ConfirmDialog
    isOpen={true}
    title={dialog.title}
    message={dialog.message}
    confirmButtonText={dialog.confirmText ?? 'Confirm'}
    cancelButtonText={dialog.cancelText ?? 'Cancel'}
    variant={dialog.variant ?? 'default'}
    onconfirm={() => feedbackService.onDialogConfirmed()}
    oncancel={() => feedbackService.onDialogCancelled()}
  />
{/if}
