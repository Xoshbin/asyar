<script lang="ts">
  import { Input } from '../../components';
  import { open } from '@tauri-apps/plugin-dialog';
  import { generateExtension, type ExtensionType } from './scaffoldService';
  import { logService } from '../../services/log/logService';
  import { FormField, Icon } from '../../components';
  import { setFocusLock } from '../../lib/ipc/commands';
  import { t } from '../../services/i18n';

  let typeOptions = $derived<
    { value: ExtensionType; label: string; icon: string; description: string }[]
  >([
    {
      value: 'view',
      icon: 'image',
      label: t('features.create_extension.type_view'),
      description: t('features.create_extension.type_view_desc'),
    },
    {
      value: 'result',
      icon: 'filter',
      label: t('features.create_extension.type_result'),
      description: t('features.create_extension.type_result_desc'),
    },
    {
      value: 'logic',
      icon: 'snippets',
      label: t('features.create_extension.type_logic'),
      description: t('features.create_extension.type_logic_desc'),
    },
    {
      value: 'theme',
      icon: 'layers',
      label: t('features.create_extension.type_theme'),
      description: t('features.create_extension.type_theme_desc'),
    },
  ]);

  let extType = $state<ExtensionType>('view');
  let extName = $state('');
  let extId = $state('');
  let extDesc = $state('');
  let saveLocation = $state('');
  let finalSaveLocation = $derived(saveLocation && extId ? `${saveLocation}/${extId}` : '');

  let isBrowsing = $state(false);
  let isGenerating = $state(false);
  let generateStatus = $state('');

  async function handleBrowse() {
    isBrowsing = true;
    try {
      await setFocusLock(true);
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: t('features.create_extension.select_save_location'),
      });
      if (selectedPath && typeof selectedPath === 'string') {
        saveLocation = selectedPath;
      }
    } catch (e) {
      logService.error(`Dialog error: ${e}`);
    } finally {
      await setFocusLock(false);
      isBrowsing = false;
    }
  }

  async function handleCreate() {
    if (!extName || !extId || !saveLocation) return;

    isGenerating = true;
    generateStatus = t('features.create_extension.initializing_scaffold');

    try {
      await generateExtension({
        name: extName,
        id: extId,
        description: extDesc || t('features.create_extension.default_description'),
        location: finalSaveLocation,
        extensionType: extType,
        onProgress: (status) => {
          generateStatus = status;
        },
      });

      setTimeout(() => {
        isGenerating = false;
        generateStatus = t('features.create_extension.generated_success');
      }, 1500);

      try {
        const { ExtensionManagerProxy } = await import('asyar-sdk/contracts');
        await new ExtensionManagerProxy().reloadExtensions();
      } catch (err) {
        logService.error(`Failed to trigger reload: ${err}`);
      }
    } catch (e: any) {
      generateStatus = `Error: ${e.message || String(e)}`;
      isGenerating = false;
    }
  }

  let idError = $derived(
    extId && !/^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+$/.test(extId)
      ? t('features.create_extension.error_dot_notation')
      : '',
  );
  let nameError = $derived(
    extName && (extName.length < 2 || extName.length > 50)
      ? t('features.create_extension.error_name_length')
      : '',
  );
  let descError = $derived(
    extDesc && (extDesc.length < 10 || extDesc.length > 200)
      ? t('features.create_extension.error_desc_length')
      : '',
  );

  let isValidForm = $derived(
    !idError &&
      !nameError &&
      !descError &&
      extName &&
      extId &&
      finalSaveLocation &&
      (!extDesc || extDesc.length >= 10),
  );

  function handleFocus() {
    window.parent?.postMessage(
      { type: 'asyar:extension:input-focus', focused: true },
      window.location.origin,
    );
  }

  function handleBlur() {
    window.parent?.postMessage(
      { type: 'asyar:extension:input-focus', focused: false },
      window.location.origin,
    );
  }
</script>

<div class="view-container">
  <div class="form-body custom-scrollbar">
    <div class="header">
      <h1 class="text-page-title">{t('features.create_extension.title')}</h1>
      <p class="text-subtitle">{t('features.create_extension.subtitle')}</p>
    </div>

    <div class="fields">
      <FormField label={t('features.create_extension.extension_type')}>
        <div class="type-grid">
          {#each typeOptions as opt}
            <label class="type-card" class:selected={extType === opt.value}>
              <input
                type="radio"
                name="ext-type"
                value={opt.value}
                checked={extType === opt.value}
                onchange={() => {
                  extType = opt.value;
                }}
                onfocus={handleFocus}
                onblur={handleBlur}
                class="sr-only"
              />
              <Icon name={opt.icon} size={18} class="type-icon" />
              <div class="type-info">
                <span class="type-label">{opt.label}</span>
                <span class="type-desc">{opt.description}</span>
              </div>
            </label>
          {/each}
        </div>
      </FormField>

      <FormField label={t('features.create_extension.extension_name')} error={nameError}>
        <Input
          unstyled
          textIntent="natural"
          type="text"
          bind:value={extName}
          placeholder={t('features.create_extension.placeholder_name')}
          autocomplete="off"
          onfocus={handleFocus}
          onblur={handleBlur}
          class="field-input {nameError ? 'error' : ''}"
        />
      </FormField>

      <FormField
        label={t('features.create_extension.extension_id')}
        hint={t('features.create_extension.hint_id')}
        error={idError}
      >
        <Input
          unstyled
          textIntent="exact"
          type="text"
          bind:value={extId}
          placeholder="com.myname.awesome-tool"
          autocomplete="off"
          onfocus={handleFocus}
          onblur={handleBlur}
          class="field-input text-mono {idError ? 'error' : ''}"
        />
      </FormField>

      <FormField
        label={t('features.create_extension.description')}
        hint={t('features.create_extension.hint_desc')}
        error={descError}
      >
        <Input
          unstyled
          textIntent="natural"
          type="text"
          bind:value={extDesc}
          placeholder={t('features.create_extension.placeholder_desc')}
          autocomplete="off"
          onfocus={handleFocus}
          onblur={handleBlur}
          class="field-input {descError ? 'error' : ''}"
        />
      </FormField>

      <FormField label={t('features.create_extension.save_location')}>
        <div class="location-row">
          <Input
            unstyled
            textIntent="exact"
            type="text"
            value={finalSaveLocation || saveLocation}
            readonly
            placeholder={t('features.create_extension.select_folder')}
            onfocus={handleFocus}
            onblur={handleBlur}
            class="field-input text-mono"
          />
          <button onclick={handleBrowse} disabled={isBrowsing} class="btn-secondary">
            {t('common.browse')}
          </button>
        </div>
      </FormField>
    </div>
  </div>

  <footer class="form-footer">
    <span class="status-text">
      {#if isGenerating}
        <span class="animate-pulse">{generateStatus}</span>
      {:else if generateStatus}
        {generateStatus}
      {/if}
    </span>
    <button onclick={handleCreate} disabled={!isValidForm || isGenerating} class="btn-primary">
      {isGenerating
        ? t('features.create_extension.creating_button')
        : t('features.create_extension.create_button')}
    </button>
  </footer>
</div>

<style>
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-8) var(--space-8) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
  }

  .header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  .type-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
  }

  .type-card {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    padding: var(--space-5);
    border-radius: var(--radius-md);
    border: 2px solid var(--border-color);
    cursor: pointer;
    transition:
      border-color var(--transition-fast),
      background var(--transition-fast);
  }

  .type-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .type-card.selected {
    border-color: var(--accent-primary);
    background: var(--bg-selected);
  }

  .type-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .type-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.2;
  }

  .type-desc {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    line-height: 1.4;
  }

  :global(.field-input.error) {
    border-color: var(--accent-danger);
  }

  .location-row {
    display: flex;
    gap: var(--space-3);
  }

  :global(.location-row .field-input) {
    flex: 1;
    opacity: 0.75;
    cursor: not-allowed;
  }

  .form-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--space-6);
    height: 52px;
    flex-shrink: 0;
    border-top: 1px solid var(--separator);
    background: var(--bg-secondary);
  }

  .status-text {
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }
</style>
