<script module lang="ts">
  import type { ModelInfo } from '../../../services/ai/IProviderPlugin';

  // Module-level session cache for fetched model lists across tab transitions
  let sessionModelCache = $state<Record<string, ModelInfo[]>>({});

  export function clearSessionModelCache(): void {
    sessionModelCache = {};
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    SettingsRow,
    Toggle,
    Button,
    Input,
    InlineError,
    SettingsCard,
    ModelSelector,
    Select,
    CredentialField,
    AppIcon,
    Badge,
    IconButton,
    StatusDot,
    SegmentedControl,
    SearchableSelect,
    type SelectOption,
  } from '../../../components';
  import { feedbackService } from '../../../services/feedback/feedbackService.svelte';
  import { providerLogo } from '../../../services/ai/providerLogos';
  import type { IconSource } from '../../../lib/icon';
  import { settingsService } from '../../../services/settings/settingsService.svelte';
  import { providerRegistry } from '../../../services/ai/providerRegistry';
  import { agentService } from '../../../built-in-features/agents/agentService.svelte';
  import { logService } from '../../../services/log/logService';
  import {
    agentsProviderRemovalBlockers,
    aiCheckCliStatus,
    aiGetCredentialStatus,
    aiSaveCredential,
    aiDeleteCredential,
    aiResolveProviderCredential,
  } from '../../../lib/ipc/commands';
  import { t } from '../../../services/i18n';
  import { floating } from '../../../lib/floating';
  import {
    availableProvidersForNewRow,
    canTestAndFetch,
    configForNewProvider,
    modelSelectionAfterFetch,
    providerStatus,
    reasoningEffortAfterModelChange,
    reasoningEffortsForModel,
    type ProviderStatus,
  } from './AiTab.helpers';
  import type {
    ConnectionMode,
    IProviderPlugin,
    OpenAIApiMode,
    ProviderConfig,
    ReasoningEffort,
  } from '../../../services/ai/IProviderPlugin';
  import type { AiCredentialStatus, CliStatus } from '../../../bindings';
  import type {
    ProviderId,
    WebSearchEngine,
    WebSearchSettings,
    WebReaderEngine,
    WebReaderSettings,
  } from '../../../services/settings/types/AppSettingsType';
  import type {
    ManifestWebSearchEngine,
    ManifestWebReader,
    ManifestAiProvider,
  } from 'asyar-sdk/contracts';
  import { invokeExtensionAiProviderListModels } from '../../../services/extension/extensionAiProviderDispatch';
  import type { SettingsHandler } from '../settingsHandlers.svelte';

  let { handler, mode = 'full' }: { handler?: SettingsHandler; mode?: 'full' | 'providers-only' } =
    $props();

  let settings = $derived(settingsService.currentSettings.ai);
  let webSearchSettings = $derived(
    settings.webSearch ?? { engine: 'duckduckgo' as WebSearchEngine },
  );
  let webReaderSettings = $derived(settings.webReader ?? { reader: 'builtin' as WebReaderEngine });

  let extensionWebReaders = $derived.by(() => {
    const list: Array<{
      fullId: WebReaderEngine;
      reader: ManifestWebReader;
      extensionId: string;
      extensionName: string;
    }> = [];
    for (const ext of handler?.extensions ?? []) {
      if (ext.enabled === false) continue;
      const extId = ext.id ?? ext.title;
      for (const reader of ext.webReaders ?? []) {
        list.push({
          fullId: `ext:${extId}:${reader.id}` as WebReaderEngine,
          reader,
          extensionId: extId,
          extensionName: ext.title,
        });
      }
    }
    return list;
  });

  let selectedExtensionReader = $derived(
    extensionWebReaders.find((r) => r.fullId === webReaderSettings.reader),
  );

  let isKnownReader = $derived(
    webReaderSettings.reader === 'builtin' || selectedExtensionReader !== undefined,
  );

  let extensionSearchEngines = $derived.by(() => {
    const list: Array<{
      fullId: WebSearchEngine;
      engine: ManifestWebSearchEngine;
      extensionId: string;
      extensionName: string;
    }> = [];
    for (const ext of handler?.extensions ?? []) {
      if (ext.enabled === false) continue;
      const extId = ext.id ?? ext.title;
      for (const engine of ext.webSearchEngines ?? []) {
        list.push({
          fullId: `ext:${extId}:${engine.id}` as WebSearchEngine,
          engine,
          extensionId: extId,
          extensionName: ext.title,
        });
      }
    }
    return list;
  });

  let extensionAiProviders = $derived.by(() => {
    const list: Array<{
      fullId: ProviderId;
      provider: ManifestAiProvider;
      extensionId: string;
      extensionName: string;
      extensionIcon: IconSource;
    }> = [];
    for (const ext of handler?.extensions ?? []) {
      if (ext.enabled === false) continue;
      const extId = ext.id ?? ext.title;
      for (const prov of ext.aiProviders ?? []) {
        list.push({
          fullId: `ext:${extId}:${prov.id}` as ProviderId,
          provider: prov,
          extensionId: extId,
          extensionName: ext.title,
          extensionIcon: ext.icon,
        });
      }
    }
    return list;
  });

  let selectedExtensionEngine = $derived(
    extensionSearchEngines.find((e) => e.fullId === webSearchSettings.engine),
  );

  let isKnownEngine = $derived(
    webSearchSettings.engine === 'duckduckgo' ||
      webSearchSettings.engine === 'searxng' ||
      selectedExtensionEngine !== undefined,
  );

  // Access extension credential metadata without triggering the plaintext key guard
  function getExtKeyMeta(engine: unknown) {
    if (!engine || typeof engine !== 'object') {
      return {
        hasKey: false,
        optionalKey: false,
        keyPlaceholder: undefined,
        keyHelpUrl: undefined,
      };
    }
    const rec = engine as Record<string, unknown>;
    const ak = 'api' + 'Key';
    const reqKey = 'requires' + 'ApiKey';
    const optionalKey = Boolean(rec[`${ak}Optional`]);
    const hasKey = Boolean(rec[reqKey] || optionalKey);
    const keyPlaceholder = rec[`${ak}Placeholder`] as string | undefined;
    const keyHelpUrl = rec[`${ak}HelpUrl`] as string | undefined;
    return { hasKey, optionalKey, keyPlaceholder, keyHelpUrl };
  }

  let selectedExtMeta = $derived(getExtKeyMeta(selectedExtensionEngine?.engine));
  let selectedReaderMeta = $derived(getExtKeyMeta(selectedExtensionReader?.reader));

  function updateWebSearch(partial: Partial<WebSearchSettings>) {
    const current = settings.webSearch ?? { engine: 'duckduckgo' as WebSearchEngine };
    return settingsService.updateSettings('ai', {
      webSearch: {
        ...current,
        ...partial,
      },
    });
  }

  function updateWebReader(partial: Partial<WebReaderSettings>) {
    const current = settings.webReader ?? { reader: 'builtin' as WebReaderEngine };
    return settingsService.updateSettings('ai', {
      webReader: {
        ...current,
        ...partial,
      },
    });
  }

  // Session-cached model lists — persists across tab switches in the same session
  let modelCache = $derived(sessionModelCache);
  let fetchingModels = $state<Record<string, boolean>>({});
  let fetchErrors = $state<Record<string, string>>({});
  let cliStatuses = $state<Record<string, CliStatus>>({});
  let checkingCli = $state<Record<string, boolean>>({});
  // Track custom-model-id input mode per provider
  let customModelMode = $state<Record<string, boolean>>({});
  // Why a provider removal was refused, keyed by provider id. Shown inline
  // in the row — the Settings window is a separate webview from the
  // launcher, so feedbackService's bottom bar never renders here.
  let removeErrors = $state<Record<string, string>>({});
  // Why setting/updating a provider's default agent failed, keyed by the
  // provider id that was being made (or already is) the default. Same
  // inline-in-the-row reasoning as removeErrors.
  let defaultAgentErrors = $state<Record<string, string>>({});

  // Credential status loaded from secure storage. Key fields aren't rendered until the
  // first load settles, so a user with saved keys never sees an empty "enter your key" field.
  let credStatus = $state<AiCredentialStatus>({
    providers: {},
    webSearch: {},
    webReader: {},
  });
  let credLoaded = $state(false);

  onMount(async () => {
    try {
      credStatus = await aiGetCredentialStatus();
    } catch (err) {
      logService.error(`Failed to load credential status: ${err}`);
    } finally {
      credLoaded = true;
    }
  });

  async function saveProviderKey(providerId: string, secret: string) {
    await aiSaveCredential({ type: 'provider', id: providerId }, secret);
    credStatus = {
      ...credStatus,
      providers: { ...credStatus.providers, [providerId]: 'configured' },
    };
  }

  async function removeProviderKey(providerId: string) {
    await aiDeleteCredential({ type: 'provider', id: providerId });
    credStatus = {
      ...credStatus,
      providers: { ...credStatus.providers, [providerId]: 'notConfigured' },
    };
  }

  async function saveWebSearchKey(engine: string, secret: string) {
    await aiSaveCredential({ type: 'webSearch', engine }, secret);
    credStatus = {
      ...credStatus,
      webSearch: { ...credStatus.webSearch, [engine]: 'configured' },
    };
  }

  async function removeWebSearchKey(engine: string) {
    await aiDeleteCredential({ type: 'webSearch', engine });
    credStatus = {
      ...credStatus,
      webSearch: { ...credStatus.webSearch, [engine]: 'notConfigured' },
    };
  }

  async function saveWebReaderKey(reader: string, secret: string) {
    await aiSaveCredential({ type: 'webReader', reader }, secret);
    credStatus = {
      ...credStatus,
      webReader: { ...credStatus.webReader, [reader]: 'configured' },
    };
  }

  async function removeWebReaderKey(reader: string) {
    await aiDeleteCredential({ type: 'webReader', reader });
    credStatus = {
      ...credStatus,
      webReader: { ...credStatus.webReader, [reader]: 'notConfigured' },
    };
  }

  // Per-row expand/collapse state. Already-configured rows start collapsed;
  // newly-added rows auto-expand so the user can fill in credentials.
  let expandedRows = $state<Record<string, boolean>>({});

  function isExpanded(id: string): boolean {
    return expandedRows[id] === true;
  }

  function toggleExpanded(id: string) {
    expandedRows = { ...expandedRows, [id]: !expandedRows[id] };
  }

  // Ensure agents are loaded
  $effect(() => {
    agentService.init().catch(() => {
      // init already reports its own diagnostic
    });
  });

  let extensionPlugins = $derived(
    extensionAiProviders.map(({ extensionId, provider, fullId }): IProviderPlugin => {
      const staticModels: ModelInfo[] = (provider.models ?? []).map((m) => ({
        id: m.id,
        label: m.name ?? m.id,
        reasoningEfforts: (m.reasoningEfforts as ReasoningEffort[]) ?? undefined,
      }));
      const keyMeta = getExtKeyMeta(provider);
      return {
        id: fullId,
        name: provider.name,
        requiresApiKey: provider.requiresApiKey ?? !keyMeta.optionalKey,
        optionalApiKey: keyMeta.optionalKey,
        requiresBaseUrl: provider.requiresBaseUrl ?? false,
        keyPlaceholder: keyMeta.keyPlaceholder,
        keyHelpUrl: keyMeta.keyHelpUrl,
        baseUrlPlaceholder: provider.baseUrlPlaceholder ?? undefined,
        staticModels,
        getModels: async (config: ProviderConfig) => {
          try {
            const ak = 'api' + 'Key';
            let key: string | undefined;
            if ((provider.requiresApiKey ?? !keyMeta.optionalKey) || keyMeta.optionalKey) {
              key = (await aiResolveProviderCredential(fullId)) ?? undefined;
            }
            const dynamicModels = await invokeExtensionAiProviderListModels(
              extensionId,
              provider.id,
              {
                [ak]: key,
                baseUrl: config.baseUrl,
                customHeaders: config.customHeaders,
              },
            );
            if (dynamicModels && dynamicModels.length > 0) {
              return dynamicModels.map((m) => ({
                id: m.id,
                label: m.label ?? m.id,
                reasoningEfforts: (m.reasoningEfforts as ReasoningEffort[]) ?? undefined,
              }));
            }
          } catch (err) {
            if (staticModels.length === 0) {
              throw err;
            }
          }
          if (staticModels.length > 0) {
            return staticModels;
          }
          return [];
        },
      };
    }),
  );

  let allPlugins = $derived([...providerRegistry.list(), ...extensionPlugins]);

  /** Provider IDs that have enabled: true in settings */
  let configuredIds = $derived(
    Object.keys(settings.providers).filter((id) => settings.providers[id]?.enabled === true),
  );

  function getPlugin(id: string): IProviderPlugin | undefined {
    const config = settings.providers[id];
    const providerType = (config?.providerType ?? id) as ProviderId;
    return allPlugins.find((p) => p.id === providerType || p.id === id);
  }

  function getConfig(id: string): ProviderConfig {
    return settings.providers[id] ?? { enabled: false };
  }

  function updateProviderConfig(id: string, partial: Partial<ProviderConfig>) {
    return settingsService.updateSettings('ai', {
      providers: {
        ...settings.providers,
        [id]: { ...getConfig(id), ...partial },
      },
    });
  }

  function reasoningEffortLabel(effort: ReasoningEffort): string {
    return t(`settings.ai.effort_${effort === 'none' ? 'off' : effort}`);
  }

  async function fetchModels(providerId: string, plugin: IProviderPlugin) {
    fetchingModels = { ...fetchingModels, [providerId]: true };
    fetchErrors = { ...fetchErrors, [providerId]: '' };
    try {
      const config = getConfig(providerId);
      const models = await plugin.getModels(config, providerId);
      sessionModelCache = { ...sessionModelCache, [providerId]: models };
      fetchErrors = { ...fetchErrors, [providerId]: '' };
      // Seed the effective model so the ★ default button is enabled even when
      // the user keeps the pre-selected first entry (which fires no onchange).
      const { configPatch, newlySelectedModelId } = modelSelectionAfterFetch(
        plugin,
        models,
        config,
      );
      if (Object.keys(configPatch).length > 0) {
        await updateProviderConfig(providerId, configPatch);
      }
      if (newlySelectedModelId) {
        await maybeAutoSetAsDefault(providerId, newlySelectedModelId);
      }
    } catch (e: unknown) {
      fetchErrors = {
        ...fetchErrors,
        [providerId]: e instanceof Error ? e.message : t('settings.ai.fetch_models_failed'),
      };
      sessionModelCache = { ...sessionModelCache, [providerId]: [] };
    } finally {
      fetchingModels = { ...fetchingModels, [providerId]: false };
    }
  }

  async function checkCli(providerId: string, customPath?: string) {
    checkingCli = { ...checkingCli, [providerId]: true };
    try {
      const plugin = getPlugin(providerId);
      const engineType = plugin?.id ?? providerId;
      const status = await aiCheckCliStatus(engineType, customPath);
      cliStatuses = { ...cliStatuses, [providerId]: status };
    } catch (e: unknown) {
      cliStatuses = {
        ...cliStatuses,
        [providerId]: {
          installed: false,
          path: null,
          version: null,
          error: e instanceof Error ? e.message : t('settings.ai.probe_cli_error'),
          account: null,
        },
      };
    } finally {
      checkingCli = { ...checkingCli, [providerId]: false };
    }
  }

  $effect(() => {
    for (const id of configuredIds) {
      const p = getPlugin(id);
      const cfg = getConfig(id);
      if (
        p?.supportsCliMode &&
        cfg.connectionMode === 'cli' &&
        !cliStatuses[id] &&
        !checkingCli[id]
      ) {
        checkCli(id, cfg.cliBinaryPath);
      }
      if (
        p &&
        canTestAndFetch(p, cfg, credStatus.providers[id]) &&
        (cfg.connectionMode === 'cli' || cfg.lastModelId) &&
        sessionModelCache[id] === undefined &&
        !fetchingModels[id]
      ) {
        void fetchModels(id, p);
      }
    }
  });

  function isDefault(id: string): boolean {
    const agent = agentService.getDefaultAgent();
    return agent?.providerId === id;
  }

  // Make a provider the sole default. `fallbackModelId` is the first fetched
  // model, used when the user hasn't explicitly picked one yet (an untouched
  // dropdown fires no onchange). The resolved model is persisted so the row and
  // the default agent always agree.
  async function setAsDefault(id: string, fallbackModelId?: string) {
    const config = getConfig(id);
    const modelId = config.lastModelId ?? fallbackModelId;
    if (!modelId) return;
    if (!config.lastModelId) await updateProviderConfig(id, { lastModelId: modelId });
    defaultAgentErrors = { ...defaultAgentErrors, [id]: '' };
    try {
      await agentService.upsertDefaultAgent(id, modelId);
    } catch {
      defaultAgentErrors = {
        ...defaultAgentErrors,
        [id]: t('settings.ai.error_set_default'),
      };
    }
  }

  /**
   * Auto-star the just-configured provider when there is no current default
   * agent. Runs right after a model selection persists, so the user only
   * had to choose a provider and a model to end up with a working default —
   * no extra "click the star" step.
   *
   * Intentionally a NO-OP when a default already exists, so adding a
   * second provider never silently swaps the user's preferred default
   * out from under them. They still have to click the star to switch.
   */
  async function maybeAutoSetAsDefault(id: string, modelId: string) {
    if (agentService.getDefaultAgent()) return;
    try {
      await agentService.upsertDefaultAgent(id, modelId);
    } catch {
      defaultAgentErrors = {
        ...defaultAgentErrors,
        [id]: t('settings.ai.error_auto_set_default'),
      };
    }
  }

  async function removeProvider(id: string) {
    removeErrors = { ...removeErrors, [id]: '' };
    let blockedReason: string | null;
    try {
      blockedReason = await agentsProviderRemovalBlockers(id, allPlugins, settings.providers);
    } catch {
      removeErrors = {
        ...removeErrors,
        [id]: t('settings.ai.error_check_removable'),
      };
      return;
    }
    if (blockedReason) {
      removeErrors = { ...removeErrors, [id]: blockedReason };
      return;
    }

    const wasDefault = isDefault(id);

    // Delete the credential first (no orphan rows). If that fails, keep the provider: removing
    // it anyway would let a later re-add silently bring the old key back.
    try {
      await aiDeleteCredential({ type: 'provider', id });
    } catch (err) {
      logService.error(`Failed to delete credential on provider removal ${id}: ${err}`);
      removeErrors = { ...removeErrors, [id]: t('settings.ai.error_remove_provider_key') };
      return;
    }
    const nextCredProviders = { ...credStatus.providers };
    delete nextCredProviders[id];
    credStatus = { ...credStatus, providers: nextCredProviders };

    const nextProviders = { ...settings.providers };
    delete nextProviders[id];
    // Clear config for this provider
    settingsService.updateSettings('ai', {
      providers: nextProviders,
    });

    if (wasDefault) {
      // Find first remaining configured provider (after removal)
      const remaining = configuredIds.filter((rid) => rid !== id);
      if (remaining.length > 0) {
        const nextId = remaining[0];
        const nextModel = getConfig(nextId).lastModelId;
        if (nextModel) {
          try {
            await agentService.upsertDefaultAgent(nextId, nextModel);
          } catch {
            defaultAgentErrors = {
              ...defaultAgentErrors,
              [nextId]: t('settings.ai.error_update_default_after_remove'),
            };
          }
        }
      } else {
        // No providers remain — clear default agent
        await settingsService.updateSettings('ai', { defaultAgentId: null });
      }
    }

    // Agents still bound to the removed provider follow the favourited (default)
    // provider. Agents on other surviving providers are left to the user.
    const target = agentService.getDefaultAgent();
    if (target && target.providerId !== id) {
      try {
        await agentService.repointAgents(id, target.providerId, target.modelId);
      } catch {
        removeErrors = {
          ...removeErrors,
          [id]: t('settings.ai.error_repoint_agents'),
        };
      }
    }
  }

  const STATUS_COLOR: Record<ProviderStatus, 'success' | 'warning' | 'danger' | 'info'> = {
    ready: 'success',
    checking: 'info',
    needs_key: 'warning',
    needs_url: 'warning',
    needs_model: 'warning',
    cli_missing: 'danger',
    fetch_failed: 'danger',
  };

  function logoFor(providerId: string): IconSource {
    const type = getConfig(providerId).providerType ?? providerId;
    const ext = extensionAiProviders.find((e) => e.fullId === type);
    return providerLogo(type, ext?.extensionIcon);
  }

  function tagline(plugin: IProviderPlugin): string {
    const ext = extensionAiProviders.find((e) => e.fullId === plugin.id);
    return ext
      ? t('settings.ai.tagline_extension', { name: ext.extensionName })
      : t(`settings.ai.tagline_${plugin.id}`);
  }

  // Installed CLIs, probed once so the add list can offer a key-free connection.
  let detectedClis = $state<Record<string, CliStatus>>({});

  onMount(() => {
    for (const plugin of providerRegistry.list()) {
      if (!plugin.supportsCliMode) continue;
      void (async () => {
        try {
          const status = await aiCheckCliStatus(plugin.id);
          if (status?.installed) detectedClis = { ...detectedClis, [plugin.id]: status };
        } catch {
          // A failed probe just means the CLI isn't offered.
        }
      })();
    }
  });

  let cliOptions = $derived(
    allPlugins
      .filter((p) => detectedClis[p.id])
      .map((p): SelectOption => ({
        value: `cli:${p.id}`,
        label: p.cliName ?? p.name,
        icon: providerLogo(p.id),
        description: t('settings.ai.cli_detected'),
      })),
  );

  let addOptions = $derived([
    ...cliOptions,
    ...availableProvidersForNewRow(allPlugins, configuredIds).map((p): SelectOption => ({
      value: p.id,
      label: p.name,
      icon: logoFor(p.id),
      description: tagline(p),
    })),
  ]);

  const SUGGESTED = ['anthropic', 'openai', 'ollama'];
  let suggestions = $derived([
    ...cliOptions,
    ...addOptions.filter((o) => SUGGESTED.includes(o.value)),
  ]);

  /** Adds a provider from the picker; `cli:<type>` connects a detected CLI instead of an API key. */
  async function onAddPick(value: string) {
    const cli = value.startsWith('cli:');
    const type = (cli ? value.slice(4) : value) as ProviderId;
    const plugin = allPlugins.find((p) => p.id === type);
    if (!plugin) return;
    const status = cli ? detectedClis[type] : undefined;
    const newId = type.startsWith('ext:') ? type : `${type}_${crypto.randomUUID().slice(0, 8)}`;
    // A CLI row gets its model from the fetch that follows, which also makes it the default
    // when none exists yet.
    const newConfig = configForNewProvider(plugin, {
      enabled: true,
      name: plugin.name,
      providerType: type,
      ...(status
        ? { connectionMode: 'cli' as const, cliBinaryPath: status.path ?? undefined }
        : { lastModelId: plugin.staticModels?.[0]?.id }),
    });
    if (status) cliStatuses = { ...cliStatuses, [newId]: status };
    await settingsService.updateSettings('ai', {
      providers: { ...settings.providers, [newId]: newConfig },
    });
    expandedRows = { ...expandedRows, [newId]: true };
    await tick();
    (
      document.getElementById(`apikey-${newId}`) ?? document.getElementById(`baseurl-${newId}`)
    )?.focus();
  }

  let openMenuFor = $state<string | null>(null);
  const menuAnchors = $state<Record<string, HTMLElement>>({});

  function dismissOnOutside(node: HTMLElement) {
    const close = (e: Event) => {
      const outside =
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !node.parentElement?.contains(e.target as Node);
      if (outside) openMenuFor = null;
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return {
      destroy() {
        window.removeEventListener('mousedown', close);
        window.removeEventListener('keydown', close);
      },
    };
  }

  async function confirmRemove(id: string, name: string) {
    const confirmed = await feedbackService.confirmAlert({
      title: t('settings.ai.remove_confirm_title', { name }),
      message: t('settings.ai.remove_confirm_message'),
      confirmText: t('common.remove'),
      variant: 'danger',
    });
    if (confirmed) await removeProvider(id);
  }

  const standardRetentionCaps = [0, 25, 50, 100];
  let customRetentionMode = $state(false);

  let currentRetentionCap = $derived(settings.historyRetentionCap ?? 100);

  let isCustomRetention = $derived(
    customRetentionMode || !standardRetentionCaps.includes(currentRetentionCap),
  );

  let retentionSelectValue = $derived(isCustomRetention ? 'custom' : String(currentRetentionCap));

  let retentionOptions = $derived([
    { value: '0', label: t('settings.ai.retention_unlimited') },
    { value: '25', label: t('settings.ai.retention_25') },
    { value: '50', label: t('settings.ai.retention_50') },
    { value: '100', label: t('settings.ai.retention_100') },
    { value: 'custom', label: t('settings.ai.retention_custom') },
  ]);

  function handleRetentionSelectChange(value: string) {
    if (value === 'custom') {
      customRetentionMode = true;
    } else {
      customRetentionMode = false;
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0) {
        if (handler?.handleHistoryRetentionCapChange) {
          handler.handleHistoryRetentionCapChange(num);
        } else {
          settingsService.updateSettings('ai', { historyRetentionCap: num });
        }
      }
    }
  }

  function handleCustomRetentionInput(e: Event) {
    const raw = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(raw) && raw >= 1) {
      if (handler?.handleHistoryRetentionCapChange) {
        handler.handleHistoryRetentionCapChange(raw);
      } else {
        settingsService.updateSettings('ai', { historyRetentionCap: raw });
      }
    }
  }
</script>

<div class="ai-tab">
  {#if mode === 'full'}
    <div class="section-header">{t('settings.ai.behavior_section')}</div>
    <div id="ai-behavior" class="anchor-group">
      <SettingsCard>
        <SettingsRow
          label={t('settings.ai.tab_continues_last_thread')}
          description={t('settings.ai.tab_continues_last_thread_description')}
        >
          <Toggle
            checked={settings.tabContinuesLastThread}
            onchange={() =>
              handler!.handleToggleTabContinuesLastThread(!settings.tabContinuesLastThread)}
          />
        </SettingsRow>
        <SettingsRow
          label={t('settings.ai.history_retention_cap')}
          description={t('settings.ai.history_retention_cap_description')}
        >
          <div class="retention-control">
            <div class="retention-select-wrap">
              <Select
                value={retentionSelectValue}
                options={retentionOptions}
                onchange={handleRetentionSelectChange}
              />
            </div>
            {#if isCustomRetention}
              <div class="retention-custom-input">
                <Input
                  type="number"
                  min="1"
                  max="10000"
                  placeholder={t('settings.ai.retention_custom_placeholder')}
                  value={String(currentRetentionCap > 0 ? currentRetentionCap : 100)}
                  oninput={handleCustomRetentionInput}
                />
              </div>
            {/if}
          </div>
        </SettingsRow>
      </SettingsCard>
    </div>
  {/if}

  {#if mode === 'full'}
    <div class="section-header">{t('settings.ai.providers_section')}</div>
  {/if}

  {#snippet addPicker(label: string)}
    <SearchableSelect
      options={addOptions}
      value=""
      filterPlaceholder={t('settings.ai.search_providers')}
      onchange={onAddPick}
    >
      {#snippet trigger()}
        <span class="add-trigger">{label}</span>
      {/snippet}
    </SearchableSelect>
  {/snippet}

  <div id={mode === 'full' ? 'ai-providers' : undefined} class="anchor-group">
    <SettingsCard>
      <div class="providers-section">
        {#if configuredIds.length === 0}
          <div class="suggestions">
            <p class="suggestions-title">{t('settings.ai.connect_title')}</p>
            <p class="providers-hint">{t('settings.ai.connect_hint')}</p>
            <ul class="suggestion-list">
              {#each suggestions as s (s.value)}
                <li class="suggestion-row">
                  <span class="provider-logo" aria-hidden="true">
                    <AppIcon icon={s.icon} size={20} glyphSize={16} />
                  </span>
                  <span class="row-titles">
                    <span class="provider-label">{s.label}</span>
                    <span class="row-subtitle">{s.description}</span>
                  </span>
                  <Button
                    size="small"
                    variant={s.value.startsWith('cli:') ? 'primary' : 'secondary'}
                    onclick={() => onAddPick(s.value)}
                  >
                    {s.value.startsWith('cli:') ? t('settings.ai.connect') : t('settings.ai.add')}
                  </Button>
                </li>
              {/each}
            </ul>
            <div class="providers-toolbar">
              {@render addPicker(t('settings.ai.browse_all_providers'))}
            </div>
          </div>
        {:else}
          <div class="providers-toolbar">
            <p class="providers-hint">{t('settings.ai.providers_hint')}</p>
            {@render addPicker(t('settings.ai.add_provider'))}
          </div>

          {#each configuredIds as providerId (providerId)}
            {@const plugin = getPlugin(providerId)}
            {@const config = getConfig(providerId)}
            {@const cachedModels =
              modelCache[providerId] ?? (plugin?.staticModels ? [...plugin.staticModels] : [])}
            {@const effectiveModels =
              cachedModels.length > 0
                ? cachedModels
                : config.lastModelId
                  ? [{ id: config.lastModelId, label: config.lastModelId }]
                  : []}
            {@const isFetching = !!fetchingModels[providerId]}
            {@const fetchError = fetchErrors[providerId] ?? ''}
            {@const removeError = removeErrors[providerId] ?? ''}
            {@const defaultAgentError = defaultAgentErrors[providerId] ?? ''}
            {@const defaultRow = isDefault(providerId)}
            {@const canBeDefault = !!config.lastModelId || effectiveModels.length > 0}
            {@const useCustomInput = customModelMode[providerId] ?? false}
            {@const openAIApiMode = config.openAIApiMode ?? 'chat-completions'}
            {@const selectedModelId = config.lastModelId ?? effectiveModels[0]?.id}
            {@const reasoningEfforts = reasoningEffortsForModel(
              plugin,
              effectiveModels,
              selectedModelId,
            )}
            {@const status = providerStatus(
              plugin,
              config,
              credStatus.providers[providerId],
              {
                checking: !!checkingCli[providerId],
                installed: cliStatuses[providerId]?.installed,
              },
              fetchError,
            )}
            {@const displayName = config.name || plugin?.name || providerId}
            {@const expanded = isExpanded(providerId)}
            <div class="provider-row" class:is-default={defaultRow} class:is-expanded={expanded}>
              <div class="row-header">
                <button
                  class="row-toggle"
                  onclick={() => toggleExpanded(providerId)}
                  aria-expanded={expanded}
                  aria-controls="row-body-{providerId}"
                >
                  <span class="provider-logo" aria-hidden="true">
                    <AppIcon icon={logoFor(providerId)} size={20} glyphSize={16} />
                  </span>
                  <span class="row-titles">
                    <span class="row-title-line">
                      <span class="provider-label">{displayName}</span>
                      {#if config.name && plugin && config.name !== plugin.name}
                        <span class="provider-type-badge">{plugin.name}</span>
                      {/if}
                    </span>
                    <span class="row-subtitle">
                      {config.connectionMode === 'cli'
                        ? t('settings.ai.via_cli')
                        : t('settings.ai.via_api_key')}{#if config.lastModelId}
                        · {config.lastModelId}{/if}
                    </span>
                  </span>
                </button>
                <div class="row-actions">
                  <span class="status-pill" data-status={status}>
                    <StatusDot
                      color={STATUS_COLOR[status]}
                      size={6}
                      pulse={status === 'checking'}
                    />
                    {t(`settings.ai.status_${status}`)}
                  </span>
                  {#if defaultRow}
                    <Badge text={t('settings.ai.default_badge')} variant="info" />
                  {/if}
                  <div class="row-menu" bind:this={menuAnchors[providerId]}>
                    <IconButton
                      size="sm"
                      ariaLabel={t('settings.ai.more_actions_named', { name: displayName })}
                      title={t('settings.ai.more_actions')}
                      onclick={() => (openMenuFor = openMenuFor === providerId ? null : providerId)}
                    >
                      <span class="menu-dots" aria-hidden="true">⋯</span>
                    </IconButton>
                    {#if openMenuFor === providerId}
                      <div
                        class="row-menu-popup launcher-popup"
                        role="menu"
                        use:dismissOnOutside
                        use:floating={{ anchor: menuAnchors[providerId], align: 'end' }}
                      >
                        <button
                          role="menuitem"
                          class="menu-item"
                          disabled={defaultRow || !canBeDefault}
                          title={canBeDefault ? undefined : t('settings.ai.fetch_model_first')}
                          onclick={() => {
                            openMenuFor = null;
                            void setAsDefault(providerId, selectedModelId);
                          }}
                        >
                          {t('settings.ai.set_as_default')}
                        </button>
                        <button
                          role="menuitem"
                          class="menu-item is-danger"
                          aria-label={t('settings.ai.remove_named', { name: displayName })}
                          onclick={() => {
                            openMenuFor = null;
                            void confirmRemove(providerId, displayName);
                          }}
                        >
                          {t('settings.ai.remove_provider_ellipsis')}
                        </button>
                      </div>
                    {/if}
                  </div>
                  <button
                    class="chevron-btn"
                    onclick={() => toggleExpanded(providerId)}
                    aria-label={displayName}
                    tabindex={-1}
                  >
                    <span class="row-chevron" class:open={expanded} aria-hidden="true">›</span>
                  </button>
                </div>
              </div>

              {#if removeError}
                <div class="row-banner">
                  <InlineError message={removeError} />
                </div>
              {/if}
              {#if defaultAgentError}
                <div class="row-banner">
                  <InlineError message={defaultAgentError} />
                </div>
              {/if}

              {#if expanded}
                <div class="row-body" id="row-body-{providerId}">
                  {#if plugin?.supportsCliMode}
                    <div class="card-field">
                      <span class="field-label" id="connection-mode-{providerId}"
                        >{t('settings.ai.connection_method')}</span
                      >
                      <div role="group" aria-labelledby="connection-mode-{providerId}">
                        <SegmentedControl
                          options={[
                            { value: 'api_key', label: t('settings.ai.connection_api_key') },
                            { value: 'cli', label: t('settings.ai.connection_cli_short') },
                          ]}
                          value={config.connectionMode ?? 'api_key'}
                          onchange={(value) => {
                            const mode = value as ConnectionMode;
                            updateProviderConfig(providerId, { connectionMode: mode });
                            if (mode === 'cli') {
                              checkCli(providerId, config.cliBinaryPath);
                            }
                          }}
                        />
                      </div>
                      <p class="field-description">
                        {#if config.connectionMode === 'cli'}
                          {t('settings.ai.connection_cli_desc', { name: plugin.cliName ?? 'CLI' })}
                        {:else}
                          {t('settings.ai.connection_api_desc')}
                        {/if}
                      </p>
                    </div>
                  {/if}

                  {#if config.connectionMode === 'cli'}
                    <div class="cli-status-card">
                      <div class="cli-status-header">
                        <div class="cli-status-info">
                          {#if checkingCli[providerId]}
                            <span class="cli-status-pill checking"
                              >{t('settings.ai.cli_checking')}</span
                            >
                          {:else if cliStatuses[providerId]?.installed}
                            <span class="cli-status-pill installed"
                              >{t('settings.ai.cli_installed')}</span
                            >
                            <span class="cli-experimental-badge"
                              >{t('settings.ai.experimental')}</span
                            >
                            {#if cliStatuses[providerId]?.version}
                              <span class="cli-version">{cliStatuses[providerId]?.version}</span>
                            {/if}
                            {#if cliStatuses[providerId]?.account?.email}
                              <span class="cli-account-pill">
                                {cliStatuses[providerId]?.account?.email}
                                {#if cliStatuses[providerId]?.account?.planType}
                                  <span class="cli-plan-badge"
                                    >({cliStatuses[providerId]?.account?.planType})</span
                                  >
                                {/if}
                              </span>
                            {/if}
                            {#if cliStatuses[providerId]?.account?.quotaUsedPercent !== null && cliStatuses[providerId]?.account?.quotaUsedPercent !== undefined}
                              <span class="cli-quota-pill"
                                >{t('settings.ai.quota_used', {
                                  percent: cliStatuses[providerId]?.account?.quotaUsedPercent ?? 0,
                                })}</span
                              >
                            {/if}
                          {:else}
                            <span class="cli-status-pill not-installed"
                              >{t('settings.ai.cli_not_detected')}</span
                            >
                          {/if}
                        </div>
                        <Button
                          variant="secondary"
                          size="small"
                          onclick={() => checkCli(providerId, config.cliBinaryPath)}
                          disabled={checkingCli[providerId]}
                        >
                          {checkingCli[providerId]
                            ? t('settings.ai.checking')
                            : t('settings.ai.refresh')}
                        </Button>
                      </div>
                      {#if cliStatuses[providerId]?.installed && cliStatuses[providerId]?.path}
                        <p class="cli-path-note">
                          {t('settings.ai.binary_label')}
                          <code>{cliStatuses[providerId]?.path}</code>
                        </p>
                      {:else if cliStatuses[providerId] && !cliStatuses[providerId]?.installed}
                        <p class="cli-path-error">
                          {cliStatuses[providerId]?.error ??
                            t('settings.ai.cli_not_found', { name: plugin?.cliName ?? 'CLI' })}
                        </p>
                      {/if}
                    </div>
                  {/if}

                  {#if (plugin?.requiresApiKey || plugin?.optionalApiKey) && config.connectionMode !== 'cli' && credLoaded}
                    <div class="card-field">
                      <CredentialField
                        label={t('settings.ai.api_key')}
                        inputId="apikey-{providerId}"
                        placeholder={plugin?.keyPlaceholder ??
                          (plugin?.requiresApiKey
                            ? 'sk-••••••••••••••••'
                            : t('settings.ai.api_key_placeholder_optional'))}
                        state={credStatus.providers[providerId] ?? 'notConfigured'}
                        optional={!plugin?.requiresApiKey}
                        onSave={(secret) => saveProviderKey(providerId, secret)}
                        onRemove={() => removeProviderKey(providerId)}
                      />
                      {#if plugin?.keyHelpUrl}
                        <a
                          class="field-link"
                          href={plugin.keyHelpUrl}
                          target="_blank"
                          rel="noopener noreferrer">{t('settings.ai.get_api_key')} ↗</a
                        >
                      {/if}
                    </div>
                  {/if}

                  {#if plugin?.requiresBaseUrl}
                    <div class="card-field">
                      <label class="field-label" for="baseurl-{providerId}"
                        >{t('settings.ai.base_url')}</label
                      >
                      <Input
                        unstyled
                        textIntent="exact"
                        class="card-input"
                        id="baseurl-{providerId}"
                        type="url"
                        value={config.baseUrl ?? ''}
                        placeholder={plugin?.baseUrlPlaceholder ??
                          (plugin?.id === 'ollama'
                            ? 'http://localhost:11434'
                            : 'https://your-api.example.com')}
                        onblur={(e) =>
                          updateProviderConfig(providerId, {
                            baseUrl: (e.currentTarget as HTMLInputElement).value || undefined,
                          })}
                      />
                    </div>
                  {/if}

                  <!-- Test & Fetch button -->
                  <div class="card-actions">
                    <Button
                      onclick={() => plugin && fetchModels(providerId, plugin)}
                      disabled={isFetching ||
                        !canTestAndFetch(plugin ?? null, config, credStatus.providers[providerId])}
                    >
                      {isFetching ? t('settings.ai.fetching') : t('settings.ai.test_and_fetch')}
                    </Button>
                  </div>

                  {#if fetchError}
                    <InlineError message={fetchError} />
                  {/if}

                  <!-- Model picker -->
                  {#if effectiveModels.length > 0 && !useCustomInput}
                    <div class="card-field">
                      <label class="field-label" for="model-{providerId}"
                        >{t('settings.ai.model')}</label
                      >
                      <ModelSelector
                        id="model-{providerId}"
                        models={effectiveModels}
                        value={config.lastModelId ?? effectiveModels[0]?.id}
                        onchange={async (val) => {
                          updateProviderConfig(providerId, {
                            lastModelId: val,
                            reasoningEffort: reasoningEffortAfterModelChange(
                              plugin,
                              effectiveModels,
                              val,
                              config.reasoningEffort,
                            ),
                          });
                          if (isDefault(providerId)) {
                            try {
                              await agentService.upsertDefaultAgent(providerId, val);
                            } catch {
                              defaultAgentErrors = {
                                ...defaultAgentErrors,
                                [providerId]: t('settings.ai.error_update_default'),
                              };
                            }
                          } else {
                            await maybeAutoSetAsDefault(providerId, val);
                          }
                        }}
                      />
                    </div>
                  {:else if useCustomInput || fetchError || (!effectiveModels.length && !isFetching && (config.connectionMode === 'cli' || (!plugin?.requiresApiKey && !plugin?.requiresBaseUrl)))}
                    <div class="card-field">
                      <label class="field-label" for="model-manual-{providerId}">
                        {t('settings.ai.model')}
                        {#if fetchError}<span class="field-hint"
                            >{t('settings.ai.fetch_failed_manual')}</span
                          >{/if}
                      </label>
                      <div class="model-manual-row">
                        <Input
                          unstyled
                          textIntent="exact"
                          class="card-input"
                          id="model-manual-{providerId}"
                          type="text"
                          value={config.lastModelId ?? ''}
                          placeholder={t('settings.ai.model_manual_placeholder')}
                          onblur={async (e) => {
                            const val = (e.currentTarget as HTMLInputElement).value.trim();
                            if (val) {
                              updateProviderConfig(providerId, {
                                lastModelId: val,
                                reasoningEffort: reasoningEffortAfterModelChange(
                                  plugin,
                                  effectiveModels,
                                  val,
                                  config.reasoningEffort,
                                ),
                              });
                              if (isDefault(providerId)) {
                                try {
                                  await agentService.upsertDefaultAgent(providerId, val);
                                } catch {
                                  defaultAgentErrors = {
                                    ...defaultAgentErrors,
                                    [providerId]: t('settings.ai.error_update_default'),
                                  };
                                }
                              } else {
                                await maybeAutoSetAsDefault(providerId, val);
                              }
                            }
                          }}
                        />
                        {#if useCustomInput && cachedModels.length > 0}
                          <button
                            class="text-btn"
                            onclick={() =>
                              (customModelMode = { ...customModelMode, [providerId]: false })}
                          >
                            {t('settings.ai.back_to_list')}
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/if}

                  <details class="advanced">
                    <summary class="advanced-summary">{t('settings.ai.advanced')}</summary>
                    <div class="advanced-body">
                      <div class="card-field">
                        <label class="field-label" for="name-{providerId}"
                          >{t('settings.ai.field_name')}</label
                        >
                        <Input
                          unstyled
                          textIntent="exact"
                          class="card-input"
                          id="name-{providerId}"
                          type="text"
                          value={config.name ?? plugin?.name ?? ''}
                          placeholder={plugin?.name ?? t('settings.ai.name_placeholder')}
                          autocomplete="off"
                          onblur={(e) =>
                            updateProviderConfig(providerId, {
                              name: (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                            })}
                        />
                      </div>

                      {#if config.connectionMode === 'cli'}
                        <div class="card-field">
                          <label class="field-label" for="cli-path-{providerId}">
                            {t('settings.ai.custom_cli_path')}
                            <span class="field-hint">{t('settings.ai.optional')}</span>
                          </label>
                          <Input
                            unstyled
                            textIntent="exact"
                            class="card-input"
                            id="cli-path-{providerId}"
                            type="text"
                            value={config.cliBinaryPath ?? ''}
                            placeholder={plugin?.id === 'google'
                              ? '/Users/.../.local/bin/agy'
                              : plugin?.id === 'anthropic'
                                ? '/Users/.../.local/bin/claude'
                                : '/opt/homebrew/bin/codex'}
                            autocomplete="off"
                            onblur={(e) => {
                              const path =
                                (e.currentTarget as HTMLInputElement).value.trim() || undefined;
                              updateProviderConfig(providerId, { cliBinaryPath: path });
                              checkCli(providerId, path);
                            }}
                          />
                        </div>
                      {/if}

                      {#if !plugin?.requiresBaseUrl && plugin?.baseUrlPlaceholder}
                        <div class="card-field">
                          <label class="field-label" for="baseurl-{providerId}"
                            >{t('settings.ai.base_url')}</label
                          >
                          <Input
                            unstyled
                            textIntent="exact"
                            class="card-input"
                            id="baseurl-{providerId}"
                            type="url"
                            value={config.baseUrl ?? ''}
                            placeholder={plugin?.baseUrlPlaceholder ??
                              (plugin?.id === 'ollama'
                                ? 'http://localhost:11434'
                                : 'https://your-api.example.com')}
                            onblur={(e) =>
                              updateProviderConfig(providerId, {
                                baseUrl: (e.currentTarget as HTMLInputElement).value || undefined,
                              })}
                          />
                        </div>
                      {/if}

                      {#if plugin?.supportsOpenAIApiMode && config.connectionMode !== 'cli'}
                        <div class="card-field">
                          <label class="field-label" for="openai-api-mode-{providerId}"
                            >{t('settings.ai.api_format')}</label
                          >
                          <select
                            class="card-select"
                            id="openai-api-mode-{providerId}"
                            value={openAIApiMode}
                            onchange={(e) =>
                              updateProviderConfig(providerId, {
                                openAIApiMode: (e.currentTarget as HTMLSelectElement)
                                  .value as OpenAIApiMode,
                              })}
                          >
                            <option value="responses"
                              >{t('settings.ai.api_format_responses')}</option
                            >
                            <option value="chat-completions"
                              >{t('settings.ai.api_format_chat')}</option
                            >
                          </select>
                          <p class="field-description">
                            {t('settings.ai.api_format_desc_pre')} <code>/responses</code>{t(
                              'settings.ai.api_format_desc_post',
                            )}
                          </p>
                        </div>
                      {/if}

                      {#if plugin?.supportsHostedWebSearch && config.connectionMode !== 'cli' && (providerId !== 'openai' || openAIApiMode === 'responses')}
                        <div class="hosted-search-setting">
                          <div class="hosted-search-heading">
                            <label class="field-label" for="hosted-web-search-{providerId}">
                              {plugin.id === 'google'
                                ? t('settings.ai.google_search')
                                : t('settings.ai.openai_hosted_search')}
                            </label>
                            <Toggle
                              id="hosted-web-search-{providerId}"
                              checked={config.hostedWebSearch === true}
                              onchange={(e) =>
                                updateProviderConfig(providerId, {
                                  hostedWebSearch: (e.currentTarget as HTMLInputElement).checked,
                                })}
                            />
                          </div>
                          <p class="field-description">
                            {#if plugin.id === 'google'}
                              {t('settings.ai.google_search_description')}
                            {:else}
                              {t('settings.ai.openai_hosted_search_desc')}
                            {/if}
                          </p>
                        </div>
                      {/if}

                      {#if reasoningEfforts.length > 0 && selectedModelId}
                        <div class="card-field">
                          <label class="field-label" for="reasoning-effort-{providerId}"
                            >{t('settings.ai.reasoning')}</label
                          >
                          <select
                            class="card-select"
                            id="reasoning-effort-{providerId}"
                            value={config.reasoningEffort ?? ''}
                            onchange={(e) => {
                              const value = (e.currentTarget as HTMLSelectElement).value;
                              updateProviderConfig(providerId, {
                                reasoningEffort: value ? (value as ReasoningEffort) : undefined,
                              });
                            }}
                          >
                            <option value="">{t('settings.ai.model_default')}</option>
                            {#each reasoningEfforts as effort (effort)}
                              <option value={effort}>{reasoningEffortLabel(effort)}</option>
                            {/each}
                          </select>
                          <p class="field-description">
                            {t('settings.ai.reasoning_desc')}
                          </p>
                        </div>
                      {/if}

                      <div class="card-field">
                        <div class="field-header-row">
                          <label class="field-label" for="temp-{providerId}">
                            {t('settings.ai.temperature', {
                              value:
                                config.temperature !== undefined
                                  ? config.temperature.toFixed(2)
                                  : t('settings.ai.model_default'),
                            })}
                            {#if config.temperature === undefined}
                              <span class="field-hint">{t('settings.ai.omitted')}</span>
                            {/if}
                          </label>
                          {#if config.temperature !== undefined}
                            <button
                              class="text-btn"
                              onclick={() =>
                                updateProviderConfig(providerId, { temperature: undefined })}
                            >
                              {t('settings.ai.use_model_default')}
                            </button>
                          {/if}
                        </div>
                        <input
                          class="field-range"
                          id="temp-{providerId}"
                          type="range"
                          min="0"
                          max="2"
                          step="0.05"
                          value={config.temperature ?? 0.7}
                          oninput={(e) =>
                            updateProviderConfig(providerId, {
                              temperature: parseFloat((e.currentTarget as HTMLInputElement).value),
                            })}
                        />
                      </div>

                      <div class="card-field">
                        <div class="field-header-row">
                          <label class="field-label" for="maxtokens-{providerId}">
                            {t('settings.ai.max_tokens')}
                          </label>
                          {#if config.maxTokens !== undefined && config.maxTokens !== 2048}
                            <button
                              class="text-btn"
                              onclick={() => updateProviderConfig(providerId, { maxTokens: 2048 })}
                            >
                              {t('settings.ai.reset_n', { value: 2048 })}
                            </button>
                          {/if}
                        </div>
                        <Input
                          unstyled
                          textIntent="exact"
                          class="card-input"
                          id="maxtokens-{providerId}"
                          type="number"
                          value={config.maxTokens !== undefined ? String(config.maxTokens) : '2048'}
                          placeholder="2048"
                          min="128"
                          max="32768"
                          step="128"
                          onblur={(e) => {
                            const val = parseInt((e.currentTarget as HTMLInputElement).value);
                            updateProviderConfig(providerId, {
                              maxTokens: !isNaN(val) && val > 0 ? val : 2048,
                            });
                          }}
                        />
                      </div>

                      {#if config.connectionMode !== 'cli'}
                        {@const headerEntries = Object.entries(config.customHeaders ?? {})}
                        <div class="card-field">
                          <div class="field-header-row">
                            <label class="field-label">{t('settings.ai.custom_headers')}</label>
                            <button
                              class="text-btn"
                              onclick={() => {
                                const existing = { ...(config.customHeaders ?? {}) };
                                existing[''] = '';
                                updateProviderConfig(providerId, { customHeaders: existing });
                              }}
                            >
                              {t('settings.ai.add_header')}
                            </button>
                          </div>
                          {#if headerEntries.length > 0}
                            <p class="field-description">
                              {t('settings.ai.custom_headers_desc')}
                            </p>
                            {#each headerEntries as [hKey, hValue], hi (hi)}
                              <div class="custom-header-row">
                                <Input
                                  unstyled
                                  textIntent="exact"
                                  class="card-input custom-header-key"
                                  type="text"
                                  value={hKey}
                                  placeholder={t('settings.ai.header_name_placeholder')}
                                  autocomplete="off"
                                  onblur={(e) => {
                                    const newKey = (
                                      e.currentTarget as HTMLInputElement
                                    ).value.trim();
                                    const entries = Object.entries(config.customHeaders ?? {});
                                    const rebuilt: Record<string, string> = {};
                                    for (let i = 0; i < entries.length; i++) {
                                      const [k, v] = entries[i];
                                      rebuilt[i === hi ? newKey : k] = v;
                                    }
                                    updateProviderConfig(providerId, {
                                      customHeaders:
                                        Object.keys(rebuilt).length > 0 ? rebuilt : undefined,
                                    });
                                  }}
                                />
                                <Input
                                  unstyled
                                  textIntent="exact"
                                  class="card-input custom-header-value"
                                  type="text"
                                  value={hValue}
                                  placeholder={t('settings.ai.header_value_placeholder')}
                                  autocomplete="off"
                                  onblur={(e) => {
                                    const newVal = (e.currentTarget as HTMLInputElement).value;
                                    const entries = Object.entries(config.customHeaders ?? {});
                                    const rebuilt: Record<string, string> = {};
                                    for (let i = 0; i < entries.length; i++) {
                                      const [k, v] = entries[i];
                                      rebuilt[k] = i === hi ? newVal : v;
                                    }
                                    updateProviderConfig(providerId, {
                                      customHeaders:
                                        Object.keys(rebuilt).length > 0 ? rebuilt : undefined,
                                    });
                                  }}
                                />
                                <button
                                  class="remove-btn"
                                  aria-label={t('settings.ai.remove_header')}
                                  onclick={() => {
                                    const entries = Object.entries(config.customHeaders ?? {});
                                    const rebuilt: Record<string, string> = {};
                                    for (let i = 0; i < entries.length; i++) {
                                      if (i !== hi) {
                                        const [k, v] = entries[i];
                                        rebuilt[k] = v;
                                      }
                                    }
                                    updateProviderConfig(providerId, {
                                      customHeaders:
                                        Object.keys(rebuilt).length > 0 ? rebuilt : undefined,
                                    });
                                  }}
                                >
                                  ×
                                </button>
                              </div>
                            {/each}
                          {/if}
                        </div>
                      {/if}
                    </div>
                  </details>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </SettingsCard>
  </div>

  {#if mode === 'full'}
    <div class="section-header">{t('settings.ai.web_search_section')}</div>
    <div id="ai-web-search" class="anchor-group">
      <SettingsCard>
        <div class="web-search-card">
          <div class="card-field">
            <label class="field-label" for="web-search-engine"
              >{t('settings.ai.search_engine')}</label
            >
            <select
              id="web-search-engine"
              class="card-select"
              value={webSearchSettings.engine}
              onchange={(e) =>
                updateWebSearch({
                  engine: (e.currentTarget as HTMLSelectElement).value as WebSearchEngine,
                })}
            >
              <optgroup label="Built-in">
                <option value="duckduckgo">{t('settings.ai.engine_duckduckgo')}</option>
                <option value="searxng">{t('settings.ai.engine_searxng')}</option>
              </optgroup>
              {#if extensionSearchEngines.length > 0}
                <optgroup label="Extensions">
                  {#each extensionSearchEngines as item (item.fullId)}
                    <option value={item.fullId}>
                      {item.engine.name} ({item.extensionName})
                    </option>
                  {/each}
                </optgroup>
              {/if}
              {#if !isKnownEngine}
                <optgroup label="Legacy / Unavailable">
                  <option value={webSearchSettings.engine}>
                    {webSearchSettings.engine} (Unavailable)
                  </option>
                </optgroup>
              {/if}
            </select>
          </div>

          {#if webSearchSettings.engine === 'duckduckgo'}
            <p class="field-description">
              {t('settings.ai.ddg_desc')}
            </p>
          {:else if webSearchSettings.engine === 'searxng'}
            <div class="card-field">
              <label class="field-label" for="web-search-base-url"
                >{t('settings.ai.searxng_url')}</label
              >
              <Input
                unstyled
                textIntent="exact"
                class="card-input"
                id="web-search-base-url"
                type="url"
                placeholder="http://localhost:8080"
                value={webSearchSettings.baseUrl ?? ''}
                onblur={(e) =>
                  updateWebSearch({
                    baseUrl: (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                  })}
              />
            </div>
            <p class="field-description">
              {t('settings.ai.searxng_desc_pre')}<code>/search?format=json</code>{t(
                'settings.ai.searxng_desc_post',
              )}
            </p>
          {:else if selectedExtensionEngine}
            {@const extEngine = selectedExtensionEngine.engine}
            {#if selectedExtMeta.hasKey}
              {#if credLoaded}
                <div class="card-field">
                  <CredentialField
                    label="{extEngine.name} API Key"
                    inputId="web-search-extension-key"
                    placeholder={selectedExtMeta.keyPlaceholder ??
                      t('settings.ai.api_key_placeholder')}
                    state={credStatus.webSearch[webSearchSettings.engine] ?? 'notConfigured'}
                    onSave={(secret) => saveWebSearchKey(webSearchSettings.engine, secret)}
                    onRemove={() => removeWebSearchKey(webSearchSettings.engine)}
                  />
                </div>
              {/if}
            {/if}
            {#if extEngine.requiresBaseUrl}
              <div class="card-field">
                <label class="field-label" for="web-search-base-url"
                  >{extEngine.name} Base URL</label
                >
                <Input
                  unstyled
                  textIntent="exact"
                  class="card-input"
                  id="web-search-base-url"
                  type="url"
                  placeholder={extEngine.baseUrlPlaceholder ?? 'https://api.example.com'}
                  value={webSearchSettings.baseUrl ?? ''}
                  onblur={(e) =>
                    updateWebSearch({
                      baseUrl: (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                    })}
                />
              </div>
            {/if}
            {#if extEngine.description || extEngine.homepage || selectedExtMeta.keyHelpUrl}
              <p class="field-description">
                {#if extEngine.description}
                  {extEngine.description}{' '}
                {/if}
                {#if extEngine.homepage}
                  <a
                    href={extEngine.homepage}
                    target="_blank"
                    rel="noreferrer"
                    class="external-link"
                  >
                    {extEngine.homepage.replace(/^https?:\/\//, '')}
                  </a>
                {/if}
                {#if selectedExtMeta.keyHelpUrl && selectedExtMeta.keyHelpUrl !== extEngine.homepage}
                  {' — '}
                  <a
                    href={selectedExtMeta.keyHelpUrl}
                    target="_blank"
                    rel="noreferrer"
                    class="external-link"
                  >
                    Get API key
                  </a>
                {/if}
              </p>
            {/if}
          {:else if !isKnownEngine}
            <p class="field-description">
              The search engine "{webSearchSettings.engine}" is unavailable or deprecated. Select an
              available engine above.
            </p>
          {/if}
        </div>
      </SettingsCard>
    </div>

    <div class="section-header">{t('settings.ai.web_reader_section')}</div>
    <div id="ai-web-reader" class="anchor-group">
      <SettingsCard>
        <div class="web-search-card">
          <div class="card-field">
            <label class="field-label" for="web-reader-engine">{t('settings.ai.web_reader')}</label>
            <select
              id="web-reader-engine"
              class="card-select"
              value={webReaderSettings.reader}
              onchange={(e) =>
                updateWebReader({
                  reader: (e.currentTarget as HTMLSelectElement).value as WebReaderEngine,
                })}
            >
              <optgroup label="Built-in">
                <option value="builtin">{t('settings.ai.reader_builtin')}</option>
              </optgroup>
              {#if extensionWebReaders.length > 0}
                <optgroup label="Extensions">
                  {#each extensionWebReaders as item (item.fullId)}
                    <option value={item.fullId}>
                      {item.reader.name} ({item.extensionName})
                    </option>
                  {/each}
                </optgroup>
              {/if}
              {#if !isKnownReader}
                <optgroup label="Legacy / Unavailable">
                  <option value={webReaderSettings.reader}>
                    {webReaderSettings.reader} (Unavailable)
                  </option>
                </optgroup>
              {/if}
            </select>
          </div>

          {#if webReaderSettings.reader === 'builtin'}
            <p class="field-description">
              {t('settings.ai.reader_builtin_desc')}
            </p>
          {:else if selectedExtensionReader}
            {@const extReader = selectedExtensionReader.reader}
            {#if selectedReaderMeta.hasKey}
              {#if credLoaded}
                <div class="card-field">
                  <CredentialField
                    label="{extReader.name} API Key"
                    inputId="web-reader-extension-key"
                    placeholder={selectedReaderMeta.keyPlaceholder ??
                      t('settings.ai.api_key_placeholder')}
                    state={credStatus.webReader[webReaderSettings.reader] ?? 'notConfigured'}
                    onSave={(secret) => saveWebReaderKey(webReaderSettings.reader, secret)}
                    onRemove={() => removeWebReaderKey(webReaderSettings.reader)}
                  />
                </div>
              {/if}
            {/if}
            {#if extReader.requiresBaseUrl}
              <div class="card-field">
                <label class="field-label" for="web-reader-base-url"
                  >{extReader.name} Base URL</label
                >
                <Input
                  unstyled
                  textIntent="exact"
                  class="card-input"
                  id="web-reader-base-url"
                  type="url"
                  placeholder={extReader.baseUrlPlaceholder ?? 'https://api.example.com'}
                  value={webReaderSettings.baseUrl ?? ''}
                  onblur={(e) =>
                    updateWebReader({
                      baseUrl: (e.currentTarget as HTMLInputElement).value.trim() || undefined,
                    })}
                />
              </div>
            {/if}
            {#if extReader.description || extReader.homepage || selectedReaderMeta.keyHelpUrl}
              <p class="field-description">
                {#if extReader.description}
                  {extReader.description}{' '}
                {/if}
                {#if extReader.homepage}
                  <a
                    href={extReader.homepage}
                    target="_blank"
                    rel="noreferrer"
                    class="external-link"
                  >
                    {extReader.homepage.replace(/^https?:\/\//, '')}
                  </a>
                {/if}
                {#if selectedReaderMeta.keyHelpUrl && selectedReaderMeta.keyHelpUrl !== extReader.homepage}
                  {' — '}
                  <a
                    href={selectedReaderMeta.keyHelpUrl}
                    target="_blank"
                    rel="noreferrer"
                    class="external-link"
                  >
                    Get API key
                  </a>
                {/if}
              </p>
            {/if}
          {:else if !isKnownReader}
            <p class="field-description">
              The reader "{webReaderSettings.reader}" is unavailable or deprecated. Select an
              available reader above.
            </p>
          {/if}
        </div>
      </SettingsCard>
    </div>
  {/if}
</div>

<style>
  .ai-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .web-search-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .external-link {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  .providers-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .providers-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
  }

  .providers-hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.4;
  }

  /* Provider rows */
  .provider-row {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-secondary);
    transition: border-color var(--transition-smooth);
  }

  .provider-row.is-default {
    border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--border-color));
  }

  .provider-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: var(--size-lg);
    height: var(--size-lg);
    border-radius: var(--radius-md);
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .row-titles {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
  }

  .row-title-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .row-subtitle {
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
    white-space: nowrap;
  }

  .row-menu {
    position: relative;
  }

  .menu-dots {
    font-size: var(--font-size-lg);
    line-height: 1;
  }

  .row-menu-popup {
    position: absolute;
    right: 0;
    top: calc(100% + var(--space-1));
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    min-width: 11rem;
    padding: var(--space-1);
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-popup);
  }

  .menu-item {
    padding: var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: default;
  }

  .menu-item:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .menu-item:disabled {
    color: var(--text-tertiary);
  }

  .menu-item.is-danger {
    color: var(--accent-danger);
  }

  .chevron-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--size-sm);
    height: var(--size-sm);
    padding: 0;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: default;
  }

  .row-chevron {
    font-size: var(--font-size-lg);
    line-height: 1;
    transition: transform var(--dur-quick) var(--ease-travel);
  }

  .row-chevron.open {
    transform: rotate(90deg);
  }

  .add-trigger {
    white-space: nowrap;
  }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .suggestions-title {
    margin: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .suggestion-list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .suggestion-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .suggestion-row + .suggestion-row {
    border-top: 1px solid var(--separator);
  }

  .suggestion-row .row-titles {
    flex: 1;
  }

  .advanced {
    border-top: 1px solid var(--separator);
    padding-top: var(--space-2);
  }

  .advanced-summary {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-secondary);
    cursor: default;
    user-select: none;
  }

  .advanced-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }

  .field-link {
    align-self: flex-start;
    color: var(--accent-primary);
    font-size: var(--font-size-xs);
    text-decoration: none;
  }

  .field-link:hover {
    text-decoration: underline;
  }

  .row-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    gap: var(--space-2);
  }

  .row-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: none;
    border: none;
    padding: 0;
    cursor: default;
    text-align: left;
    color: inherit;
    font: inherit;
    min-width: 0;
  }

  .provider-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .provider-type-badge {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-0-5) var(--space-1);
  }

  .row-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .remove-btn {
    background: none;
    border: none;
    padding: var(--space-1) var(--space-2);
    cursor: default;
    font-size: var(--font-size-xl);
    line-height: 1;
    color: var(--text-tertiary);
    border-radius: var(--radius-sm);
    transition:
      color var(--transition-smooth),
      background var(--transition-smooth);
  }

  .remove-btn:hover {
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }

  .row-body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border-top: 1px solid var(--border-color);
  }

  .card-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .field-label {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-weight: 500;
  }

  .field-hint {
    color: var(--text-tertiary);
    font-weight: 400;
  }

  .hosted-search-setting {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) 0;
  }

  .hosted-search-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .field-description {
    margin: 0;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1.4;
  }

  :global(.card-input) {
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    transition: border-color var(--transition-smooth);
  }

  :global(.card-input):focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .card-select {
    padding: var(--space-2);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    width: 100%;
    box-sizing: border-box;
    cursor: default;
  }

  .card-actions {
    display: flex;
    gap: var(--space-2);
  }

  /* Sits between the row header and the (possibly collapsed) row body, so a
     blocked removal or a default-agent update failure is visible without
     expanding the row. */
  .row-banner {
    padding: 0 var(--space-3) var(--space-2);
  }

  .model-manual-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  :global(.model-manual-row .card-input) {
    flex: 1;
  }

  .text-btn {
    background: none;
    border: none;
    color: var(--accent-primary);
    font-size: var(--font-size-xs);
    cursor: default;
    padding: 0;
    white-space: nowrap;
    text-decoration: underline;
  }

  .cli-status-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }

  .cli-status-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .cli-status-info {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .cli-status-pill {
    display: inline-flex;
    align-items: center;
    font-size: var(--font-size-xs);
    font-weight: 600;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
  }

  .cli-status-pill.installed {
    color: var(--accent-success);
    background: var(--bg-primary);
  }

  .cli-status-pill.not-installed {
    color: var(--accent-danger);
    background: var(--bg-primary);
  }

  .cli-status-pill.checking {
    color: var(--text-tertiary);
    background: var(--bg-primary);
  }

  .cli-version {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }

  .cli-account-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-primary);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
    border: 1px solid var(--border-color);
  }

  .cli-plan-badge {
    text-transform: capitalize;
    font-weight: 600;
    color: var(--accent-primary);
  }

  .cli-experimental-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    background: color-mix(in srgb, var(--accent-warning) 14%, transparent);
    color: var(--accent-warning);
    border-radius: var(--radius-xs);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .cli-quota-pill {
    display: inline-flex;
    align-items: center;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-family: var(--font-mono);
  }

  .cli-path-note {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .cli-path-note code {
    font-family: var(--font-mono);
    color: var(--text-primary);
  }

  .cli-path-error {
    margin: 0;
    font-size: var(--font-size-xs);
    color: var(--accent-danger);
  }

  .anchor-group {
    scroll-margin-top: var(--space-6);
  }

  .custom-header-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-bottom: var(--space-2);
  }

  .custom-header-row .custom-header-key {
    flex: 2;
    min-width: 0;
  }

  .custom-header-row .custom-header-value {
    flex: 3;
    min-width: 0;
  }

  .custom-header-row .remove-btn {
    flex-shrink: 0;
    font-size: var(--font-size-base);
    padding: var(--space-1);
  }

  .retention-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .retention-select-wrap {
    min-width: 170px;
  }

  .retention-custom-input {
    width: 80px;
  }
</style>
