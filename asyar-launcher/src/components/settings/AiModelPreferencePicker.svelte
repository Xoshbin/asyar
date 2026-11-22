<script lang="ts">
  import SearchableSelect, { type SelectOption } from '../form/SearchableSelect.svelte';
  import { aiService } from '../../services/ai/aiService';
  import { t } from '../../services/i18n';
  import { isValidAiModelRef, type AiConfiguredModel, type AiModelRef } from 'asyar-sdk/contracts';

  interface Props {
    value?: unknown;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    onchange: (value: AiModelRef | undefined) => void;
  }

  let { value, required = false, disabled = false, placeholder, onchange }: Props = $props();

  const USE_DEFAULT_OPTION_VALUE = '';

  let models = $state<AiConfiguredModel[]>([]);
  let isLoading = $state(true);
  let loadFailed = $state(false);

  function encodeModelRef(ref: AiModelRef): string {
    return JSON.stringify([ref.providerId, ref.modelId]);
  }

  $effect(() => {
    let cancelled = false;
    isLoading = true;
    loadFailed = false;
    aiService
      .listModels()
      .then((list) => {
        if (!cancelled) {
          models = list;
        }
      })
      .catch(() => {
        if (!cancelled) {
          models = [];
          loadFailed = true;
        }
      })
      .finally(() => {
        if (!cancelled) {
          isLoading = false;
        }
      });

    return () => {
      cancelled = true;
    };
  });

  const currentRef = $derived(isValidAiModelRef(value) ? value : null);
  const selectedValue = $derived(
    currentRef ? encodeModelRef(currentRef) : USE_DEFAULT_OPTION_VALUE,
  );

  const options = $derived.by<SelectOption[]>(() => {
    const items: SelectOption[] = [];

    if (!required) {
      items.push({
        value: USE_DEFAULT_OPTION_VALUE,
        label: t('settings.extensions.ai_model_use_default'),
      });
    }

    const hasCurrentInList =
      currentRef !== null &&
      models.some(
        (m) => m.providerId === currentRef.providerId && m.modelId === currentRef.modelId,
      );

    if (currentRef && !hasCurrentInList) {
      const baseLabel = `${currentRef.providerId} — ${currentRef.modelId}`;
      items.push({
        value: encodeModelRef(currentRef),
        label: isLoading
          ? baseLabel
          : `${baseLabel} (${t('settings.extensions.ai_model_unavailable')})`,
      });
    }

    for (const model of models) {
      const suffix = model.isDefault ? ` (${t('settings.extensions.ai_model_default_badge')})` : '';
      items.push({
        value: encodeModelRef(model),
        label: `${model.providerName} — ${model.label}${suffix}`,
      });
    }

    return items;
  });

  const effectivePlaceholder = $derived(
    isLoading
      ? t('settings.extensions.ai_model_loading')
      : placeholder ||
          (!required
            ? t('settings.extensions.ai_model_use_default')
            : t('settings.extensions.ai_model_select')),
  );

  function handleSelectChange(raw: string) {
    if (raw === USE_DEFAULT_OPTION_VALUE) {
      onchange(undefined);
      return;
    }
    const matched =
      models.find((m) => encodeModelRef(m) === raw) ??
      (currentRef && encodeModelRef(currentRef) === raw ? currentRef : undefined);
    onchange(matched ? { providerId: matched.providerId, modelId: matched.modelId } : undefined);
  }
</script>

<div class="ai-model-picker">
  <SearchableSelect
    value={selectedValue}
    {options}
    placeholder={effectivePlaceholder}
    disabled={disabled || (isLoading && options.length === 0)}
    onchange={handleSelectChange}
  />

  {#if loadFailed}
    <div class="picker-error" role="alert">
      {t('settings.extensions.ai_model_load_failed')}
    </div>
  {:else if !isLoading && models.length === 0}
    <div class="picker-hint">
      {t('settings.extensions.ai_model_none_configured')}
    </div>
  {/if}
</div>

<style>
  .ai-model-picker {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .picker-hint {
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
  }

  .picker-error {
    color: var(--accent-danger);
    font-size: var(--font-size-xs);
    font-family: var(--font-ui);
  }
</style>
