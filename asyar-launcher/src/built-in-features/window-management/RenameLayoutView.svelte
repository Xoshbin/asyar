<script lang="ts">
  import { FormField, FormView, Input } from '../../components';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { t } from '../../services/i18n';
  import { renameLayout } from './layoutLifecycle';
  import { windowManagementState } from './state.svelte';

  const targetLayout = $derived(
    windowManagementState.customLayouts.find(
      (l) => l.id === windowManagementState.renamingLayoutId,
    ) ?? windowManagementState.selectedLayout,
  );

  let name = $state('');

  $effect(() => {
    name = targetLayout?.name ?? '';
  });

  async function handleSave() {
    const id = targetLayout?.id;
    const trimmed = name.trim();
    if (!id || !trimmed) return;
    await renameLayout(id, trimmed, windowManagementState.store ?? undefined);
    await feedbackService.showHUD(`Renamed to "${trimmed}"`);
    windowManagementState.clearRename();
    viewManager.goBack();
  }

  function handleCancel() {
    windowManagementState.clearRename();
    viewManager.goBack();
  }
</script>

<FormView
  actionId="window-management:rename-save"
  submitLabel={t('common.save')}
  extensionId="window-management"
  category="window-management"
  submitDisabled={!name.trim()}
  restoreSearchFocusOnCancel={true}
  onsubmit={handleSave}
  oncancel={handleCancel}
>
  {#snippet header()}
    <div class="rename-header">
      <h2 class="form-title">{t('features.window_management.rename_layout_title')}</h2>
      <p class="form-subtitle">{t('features.window_management.rename_layout_subtitle')}</p>
    </div>
  {/snippet}

  <FormField label={t('common.name')} id="rename-layout-name">
    <Input
      unstyled
      textIntent="natural"
      id="rename-layout-name"
      class="field-input"
      placeholder={t('features.window_management.rename_layout_placeholder')}
      bind:value={name}
    />
  </FormField>
</FormView>

<style>
  .rename-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }
  .form-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .form-subtitle {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: 0;
  }
</style>
