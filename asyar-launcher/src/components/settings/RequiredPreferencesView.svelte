<script lang="ts">
  import FormView from '../form/FormView.svelte';
  import ExtensionAvatar from '../base/ExtensionAvatar.svelte';
  import ExtensionPreferencesForm from './ExtensionPreferencesForm.svelte';
  import type { PreferenceDeclaration } from 'asyar-sdk/contracts';
  import { preferencesPromptStore } from '../../services/extension/preferencesPromptStore.svelte';
  import { extensionPreferencesService } from '../../services/extension/extensionPreferencesService.svelte';
  import { commandService } from '../../services/extension/commandService.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';

  let {
    extensionId,
    commandId,
    commandObjectId,
    commandArgs,
    missing,
    onClose,
  }: {
    extensionId: string;
    commandId: string;
    commandObjectId: string;
    commandArgs?: Record<string, any>;
    missing: PreferenceDeclaration[];
    onClose?: () => void;
  } = $props();

  let values = $state<Record<string, unknown>>({});
  let isSaving = $state(false);
  let errors = $state<Record<string, string>>({});

  // Seed any defaults declared on the missing preferences so dropdowns with
  // defaults start ready without extra clicks.
  $effect(() => {
    const seeded: Record<string, unknown> = {};
    for (const pref of missing) {
      if (pref.default !== undefined) {
        seeded[pref.name] = pref.default;
      } else if (pref.type === 'dropdown' && pref.data?.length) {
        seeded[pref.name] = pref.data[0].value;
      }
    }
    values = seeded;
  });

  const manifest = $derived(extensionManager.getManifestById(extensionId) ?? null);
  const extensionName = $derived(manifest?.name ?? extensionId);
  const commandName = $derived(
    manifest?.commands?.find((c) => c.id === commandId)?.name ?? commandId,
  );

  const isComplete = $derived(
    missing.every((p) => {
      const v = values[p.name];
      if (p.type === 'checkbox') return typeof v === 'boolean';
      if (p.type === 'number') return typeof v === 'number' && Number.isFinite(v);
      return v !== undefined && v !== null && v !== '';
    }),
  );

  function handleChange(key: string, value: unknown) {
    values = { ...values, [key]: value };
    delete errors[key];
  }

  async function handleSave() {
    if (!isComplete || isSaving) return;
    isSaving = true;
    errors = {};
    try {
      for (const [key, value] of Object.entries(values)) {
        const decl = missing.find((p) => p.name === key);
        if (!decl) continue;

        const decls = extensionPreferencesService.getDeclarations(extensionId);
        const isExtensionLevel = decls?.extension.some((p) => p.name === key) ?? false;
        const scope: string | null = isExtensionLevel ? null : commandId;

        try {
          await extensionPreferencesService.set(extensionId, scope, key, value);
        } catch (err) {
          errors[key] = `${decl.title ?? key}: ${err instanceof Error ? err.message : String(err)}`;
          logService.error(
            `RequiredPreferencesView: failed to save '${key}' for ${extensionId}: ${err}`,
          );
          return;
        }
      }

      preferencesPromptStore.close();

      try {
        if (commandArgs === undefined) await commandService.executeCommand(commandObjectId);
        else await commandService.executeCommand(commandObjectId, commandArgs);
      } catch (err) {
        logService.error(
          `RequiredPreferencesView: command re-invocation failed for ${commandObjectId}: ${err}`,
        );
      }
    } finally {
      isSaving = false;
    }
  }

  function handleCancel() {
    if (isSaving) return;
    preferencesPromptStore.close();
    onClose?.();
  }
</script>

<FormView
  actionId="preferences-prompt:continue"
  submitLabel={isSaving ? t('settings.ai.saving') : t('common.continue')}
  extensionId="preferences-prompt"
  submitDisabled={!isComplete || isSaving}
  restoreSearchFocusOnCancel={true}
  onsubmit={handleSave}
  oncancel={handleCancel}
>
  <div class="required-prefs-shell">
    <div class="required-prefs-hero">
      <ExtensionAvatar name={extensionName} icon={manifest?.resolvedIcon} size="lg" />
      <h2 class="text-page-title hero-title">{extensionName}</h2>
      <p class="text-body hero-subtitle">
        {t('settings.extensions.required_setup_pre')}
        <strong>{extensionName}</strong>
        {t('settings.extensions.required_setup_mid')}
        <strong>{commandName}</strong>.
      </p>
    </div>

    <div class="required-prefs-fields">
      <ExtensionPreferencesForm
        preferences={missing}
        {values}
        {errors}
        disabled={isSaving}
        onChange={handleChange}
      />
    </div>
  </div>
</FormView>

<style>
  .required-prefs-shell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-5);
    width: 100%;
  }

  .required-prefs-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-2);
    max-width: 28rem;
  }

  .hero-title {
    margin: var(--space-1) 0 0;
    color: var(--text-primary);
  }

  .hero-subtitle {
    margin: 0;
    color: var(--text-secondary);
  }

  .required-prefs-fields {
    width: 100%;
    max-width: 28rem;
  }
</style>
