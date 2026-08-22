<script lang="ts">
  import { envService } from '../../services/envService';
  import { storeViewState as store, getInstallCount } from './state.svelte';
  import { logService } from '../../services/log/logService';
  import {
    LoadingState,
    EmptyState,
    ExtensionAvatar,
    StatusDot,
    Badge,
    WarningBanner,
    Button,
  } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { nameToGradient } from '../../lib/extensionAvatar';

  import * as commands from '../../lib/ipc/commands'; // Import commands
  import storeExtension from './index.svelte';
  import { onMount } from 'svelte';
  import { extensionUpdateService } from '../../services/extension/extensionUpdateService.svelte';
  import { commandService } from '../../services/extension/commandService.svelte';
  import PermissionList from '../../components/settings/PermissionList.svelte';
  import { renderMarkdown, handleMarkdownCopyClick } from '../../utils/markdown';
  import type { ManifestCommand, ManifestPreference } from './state.svelte';
  import { t } from '../../services/i18n';

  // Define structure for detailed API response
  interface ExtensionDetail {
    id: string;
    name: string;
    slug: string;
    description: string;
    category: string;
    status: string;
    repoUrl: string;
    installCount: number;
    iconUrl: string | null;
    createdAt: string;
    updatedAt: string;
    readme?: string | null;
    author: {
      name: string;
      githubUsername: string | null;
      avatarUrl: string | null;
      isVerifiedPublisher: boolean;
    };
    version: string | null;
    asyarSdk?: string;
    manifest?: {
      platforms?: string[];
      permissions?: string[];
      permissionArgs?: Record<string, unknown>;
      runtimes?: string[];
      commands?: ManifestCommand[];
      preferences?: ManifestPreference[];
      readme?: string;
    };
  }

  let extensionDetail = $state<ExtensionDetail | null>(null);
  let isLoading = $state(true);
  let isInstalled = $state(false);
  let error = $state<string | null>(null);

  let readmeHtml = $derived(
    extensionDetail?.manifest?.readme
      ? renderMarkdown(extensionDetail.manifest.readme)
      : extensionDetail?.readme
        ? renderMarkdown(extensionDetail.readme)
        : null,
  );

  let hasUpdate = $derived(
    extensionDetail?.id
      ? !!extensionUpdateService.getUpdateForExtension(extensionDetail.id)
      : false,
  );
  let availableUpdate = $derived(
    extensionDetail?.id
      ? extensionUpdateService.getUpdateForExtension(extensionDetail.id)
      : undefined,
  );
  let isTheme = $derived(extensionDetail?.category?.toLowerCase() === 'theme');
  let detailGradient = $derived(
    extensionDetail
      ? nameToGradient(extensionDetail.name)
      : { from: 'transparent', to: 'transparent' },
  );

  // Use reactive subscriptions to the store instance
  let currentSlug = $derived(store.selectedExtensionSlug);
  let extensionManager = $derived(store.extensionManager);

  // Manifest metadata from the detail response or store listing
  let manifest = $derived(
    extensionDetail?.manifest ??
      (currentSlug
        ? store?.allItems.find((item) => item.slug === currentSlug)?.manifest
        : undefined),
  );
  let listedPermissions = $derived(manifest?.permissions ?? []);
  let declaredCommands = $derived<ManifestCommand[]>(manifest?.commands ?? []);
  let declaredPreferences = $derived<ManifestPreference[]>(manifest?.preferences ?? []);
  let primaryCommand = $derived(
    declaredCommands.find((c) => c.searchable !== false) ?? declaredCommands[0],
  );

  $effect(() => {
    if (currentSlug) {
      fetchExtensionDetails(currentSlug);
    } else {
      extensionDetail = null;
      error = 'No extension selected.';
      isLoading = false;
    }
  });

  $effect(() => {
    if (extensionDetail?.id) {
      checkIsInstalled(extensionDetail.id);
    }
  });

  async function checkIsInstalled(extensionId: string) {
    if (!extensionId) {
      isInstalled = false;
      storeExtension.notifyInstalledStateChanged(false, undefined);
      return;
    }
    try {
      const installedPaths: string[] = (await commands.listInstalledExtensions()) ?? [];
      isInstalled = installedPaths.some(
        (p) => p.endsWith(`/${extensionId}`) || p.endsWith(`\\${extensionId}`) || p === extensionId,
      );
      storeExtension.notifyInstalledStateChanged(isInstalled, extensionId);
    } catch (e) {
      logService?.error(`Failed to check installed status: ${e}`);
      isInstalled = false;
      storeExtension.notifyInstalledStateChanged(false, undefined);
    }
  }

  function handleStoreExtensionInstalled(e: any) {
    if (e.detail?.id === extensionDetail?.id && extensionDetail?.id)
      checkIsInstalled(extensionDetail.id);
    else if (e.detail?.slug === currentSlug && extensionDetail?.id)
      checkIsInstalled(extensionDetail.id);
  }
  function handleStoreExtensionUninstalled(e: any) {
    if (e.detail?.id === extensionDetail?.id && extensionDetail?.id)
      checkIsInstalled(extensionDetail.id);
    else if (e.detail?.slug === currentSlug && extensionDetail?.id)
      checkIsInstalled(extensionDetail.id);
  }

  onMount(() => {
    window.addEventListener('store-extension-installed', handleStoreExtensionInstalled);
    window.addEventListener('store-extension-uninstalled', handleStoreExtensionUninstalled);
    window.addEventListener('store-extension-updated', handleStoreExtensionInstalled);
    return () => {
      window.removeEventListener('store-extension-installed', handleStoreExtensionInstalled);
      window.removeEventListener('store-extension-uninstalled', handleStoreExtensionUninstalled);
      window.removeEventListener('store-extension-updated', handleStoreExtensionInstalled);
    };
  });

  async function fetchExtensionDetails(slug: string) {
    logService.debug(`[DetailView] fetchExtensionDetails START for slug: ${slug}`); // Log start
    isLoading = true;
    error = null;
    extensionDetail = null;
    logService?.info(`Fetching details for slug: ${slug}`);
    try {
      const response = await fetch(`${envService.storeApiBaseUrl}/api/extensions/${slug}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      extensionDetail = data.data || data; // Handle both wrapped and direct JSON objects
      logService.debug(
        `[DetailView] Successfully fetched and parsed data: ${JSON.stringify(extensionDetail)}`,
      ); // Log success and data
      logService?.info(`Fetched details for ${extensionDetail?.name}`);
    } catch (e: any) {
      logService.error(`[DetailView] Fetch error: ${e}`); // Log fetch errors
      logService?.error(`Failed to fetch extension details: ${e.message}`);
      error = `Failed to load details: ${e.message}`;
    } finally {
      isLoading = false;
      logService.debug(`[DetailView] fetchExtensionDetails FINALLY. isLoading set to false.`); // Log end
    }
  }

  async function installExtension() {
    if (!extensionDetail || !currentSlug) return;

    error = null;
    try {
      await storeExtension.installExtension(currentSlug, extensionDetail.id, extensionDetail.name);
      if (extensionDetail?.id) await checkIsInstalled(extensionDetail.id);
    } catch (e: any) {
      const errorMessage = typeof e === 'string' ? e : e?.message || String(e);
      error = `Installation failed: ${errorMessage}`;
    }
  }

  async function uninstallExtension() {
    if (!extensionDetail || !currentSlug) return;

    const confirmed = await feedbackService.confirmAlert({
      title: 'Uninstall extension',
      message: `Uninstall ${extensionDetail.name}? You can reinstall it from the store.`,
      confirmText: 'Uninstall',
      variant: 'danger',
    });
    if (!confirmed) return;

    error = null;
    try {
      await storeExtension.uninstallExtension(
        currentSlug,
        extensionDetail.id,
        extensionDetail.name,
      );
      if (extensionDetail?.id) await checkIsInstalled(extensionDetail.id);
    } catch (e: any) {
      const errorMessage = typeof e === 'string' ? e : e?.message || String(e);
      error = `Uninstall failed: ${errorMessage}`;
    }
  }

  async function handleUpdate() {
    if (!extensionDetail || !currentSlug) return;
    error = null;
    try {
      await storeExtension.updateExtension(currentSlug, extensionDetail.id, extensionDetail.name);
      if (extensionDetail?.id) await checkIsInstalled(extensionDetail.id);
    } catch (e: any) {
      const errorMessage = typeof e === 'string' ? e : e?.message || String(e);
      error = `Update failed: ${errorMessage}`;
    }
  }

  async function runCommand(commandId: string) {
    if (!extensionDetail?.id) return;
    const objectId = `cmd_${extensionDetail.id}_${commandId}`;
    try {
      await commandService.executeCommand(objectId);
    } catch (e: any) {
      logService?.error(`Failed to execute command ${objectId}: ${e}`);
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not run command "${commandId}"` },
      });
    }
  }

  async function openPreferences() {
    if (!extensionDetail?.id) return;
    try {
      await commands.showSettingsWindow({
        tab: 'extensions',
        extensionId: String(extensionDetail.id),
      });
    } catch (e: any) {
      logService?.error(`Failed to open preferences in settings: ${e}`);
    }
  }
</script>

<div
  class="extension-detail-view bg-[var(--bg-primary)] h-full w-full flex flex-col overflow-hidden focus:outline-none"
  tabindex="-1"
>
  <div
    class="detail-accent-strip"
    style="background: linear-gradient(90deg, {detailGradient.from}, {detailGradient.to});"
  ></div>

  <div class="flex-1 overflow-y-auto custom-scrollbar">
    {#if isLoading}
      <LoadingState message={t('common.loading')} />
    {:else if error}
      <div class="p-6">
        <EmptyState message={t('common.error')} description={error}>
          {#snippet icon()}
            <span style="color: var(--accent-danger);">⚠️</span>
          {/snippet}
        </EmptyState>
      </div>
    {:else if extensionDetail}
      <div class="w-full max-w-5xl mx-auto px-6 py-8 md:px-12 md:py-12">
        <!-- Header Section -->
        <div class="flex flex-col md:flex-row items-start md:items-center gap-8 mb-12">
          <ExtensionAvatar name={extensionDetail.name} size="xl" />

          <div class="flex-1 min-w-0">
            <h1 class="text-page-title mb-3" style="font-size: var(--font-size-3xl);">
              {extensionDetail.name}
            </h1>
            <div class="flex flex-wrap items-center gap-3 text-caption mb-6">
              <span class="flex items-center gap-1.5 text-[var(--text-primary)]">
                <span
                  class="w-5 h-5 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center"
                  style="font-size: var(--font-size-2xs);">👤</span
                >
                {extensionDetail?.author?.name || 'Unknown'}
              </span>
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--separator)]"></span>
              <Badge text={extensionDetail.category} variant="default" mono />
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--separator)]"></span>
              <span class="flex items-center gap-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  /></svg
                >
                {getInstallCount(extensionDetail).toLocaleString()} Installs
              </span>
            </div>

            <div class="flex items-center gap-3 flex-wrap">
              {#if isInstalled && hasUpdate}
                <Button class="btn-primary h-10 px-6 font-semibold" onclick={handleUpdate}>
                  Update to v{availableUpdate?.latestVersion}
                </Button>
                <Button class="btn-danger h-10 px-5 font-semibold" onclick={uninstallExtension}>
                  Uninstall
                </Button>
              {:else if isInstalled}
                {#if primaryCommand}
                  <Button
                    class="btn-primary h-10 px-6 font-semibold"
                    onclick={() => runCommand(primaryCommand.id)}
                  >
                    Run {primaryCommand.name}
                  </Button>
                {/if}
                {#if declaredPreferences.length > 0}
                  <Button class="btn-secondary h-10 px-4 font-semibold" onclick={openPreferences}>
                    Configure
                  </Button>
                {/if}
                <Button class="btn-danger h-10 px-5 font-semibold" onclick={uninstallExtension}>
                  Uninstall
                </Button>
              {:else}
                <Button class="btn-primary h-10 px-6 font-semibold" onclick={installExtension}>
                  {isTheme ? 'Install Theme' : 'Install Extension'}
                </Button>
              {/if}

              {#if isInstalled && isTheme}
                <div
                  class="flex items-center gap-2 px-4 py-2 rounded-lg text-caption"
                  style="background: color-mix(in srgb, var(--accent-primary) 10%, transparent); color: var(--accent-primary);"
                >
                  <svg
                    class="w-4 h-4 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    /></svg
                  >
                  Activate in Settings → Appearance → Custom Themes
                </div>
              {/if}

              <!-- TODO: Implement actual satisfaction check against SUPPORTED_SDK_VERSION when store API provides asyarSdk -->
              {#if !isInstalled && extensionDetail?.asyarSdk}
                <WarningBanner>
                  {#snippet children()}
                    <p class="text-caption">
                      This extension requires a newer version of Asyar (SDK {extensionDetail?.asyarSdk})
                    </p>
                  {/snippet}
                </WarningBanner>
              {/if}

              {#if extensionDetail.repoUrl}
                <a
                  href={extensionDetail.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn-secondary flex items-center gap-2"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"
                    ><path
                      fill-rule="evenodd"
                      d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      clip-rule="evenodd"
                    /></svg
                  >
                  GitHub
                </a>
              {/if}
            </div>
          </div>
        </div>

        <hr class="border-[var(--separator)] mb-10" />

        <!-- Main Content Area -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-12">
          <!-- Left Column: Description, Commands & Preferences -->
          <div class="lg:col-span-2 space-y-10">
            <section>
              <h3 class="text-section mb-3">About</h3>
              <div class="prose max-w-none text-body">
                <p>{extensionDetail?.description || 'No description provided.'}</p>
              </div>
            </section>

            {#if declaredCommands.length > 0}
              <section>
                <div class="flex items-center justify-between mb-4">
                  <h3 class="text-section">Commands & Actions</h3>
                  <span class="text-caption text-[var(--text-tertiary)]">
                    {declaredCommands.length}
                    {declaredCommands.length === 1 ? 'command' : 'commands'}
                  </span>
                </div>

                <div class="space-y-3">
                  {#each declaredCommands as cmd}
                    <div class="command-card">
                      <div class="command-header">
                        <div class="flex items-center gap-2.5 min-w-0 flex-1">
                          {#if cmd.icon}
                            <span class="command-icon">{cmd.icon}</span>
                          {/if}
                          <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                              <span class="text-title font-medium text-[var(--text-primary)]"
                                >{cmd.name}</span
                              >
                              {#if cmd.mode}
                                <Badge
                                  text={cmd.mode === 'view'
                                    ? 'View'
                                    : cmd.mode === 'background'
                                      ? 'Background'
                                      : cmd.mode}
                                  variant={cmd.mode === 'view' ? 'info' : 'default'}
                                  mono
                                />
                              {/if}
                              {#if cmd.trigger}
                                <code class="arg-chip text-mono">{cmd.trigger}</code>
                              {/if}
                            </div>
                          </div>
                        </div>

                        {#if isInstalled}
                          <Button
                            class="btn-secondary h-7 px-3 text-caption flex-shrink-0"
                            onclick={() => runCommand(cmd.id)}
                          >
                            Run
                          </Button>
                        {/if}
                      </div>

                      {#if cmd.description}
                        <p class="text-caption text-[var(--text-secondary)] mt-2">
                          {cmd.description}
                        </p>
                      {/if}

                      {#if cmd.arguments && cmd.arguments.length > 0}
                        <div class="command-args mt-3 pt-2.5 border-t border-[var(--separator)]">
                          <span class="text-caption text-[var(--text-tertiary)] mr-2"
                            >Arguments:</span
                          >
                          <div class="inline-flex flex-wrap gap-1.5 align-middle">
                            {#each cmd.arguments as arg}
                              <code class="arg-chip text-mono">
                                {arg.placeholder || arg.name}{#if arg.required}*{/if}
                              </code>
                            {/each}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </section>
            {/if}

            {#if readmeHtml}
              <section>
                <div class="flex items-center justify-between mb-4">
                  <h3 class="text-section">Documentation & Guide</h3>
                </div>
                <div
                  class="prose max-w-none text-body bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--separator)] overflow-x-auto markdown-body"
                  onclick={handleMarkdownCopyClick}
                >
                  {@html readmeHtml}
                </div>
              </section>
            {/if}

            {#if declaredPreferences.length > 0}
              <section>
                <div class="flex items-center justify-between mb-4">
                  <h3 class="text-section">Configurable Settings</h3>
                  {#if isInstalled}
                    <button class="preferences-link" onclick={openPreferences}>
                      Open in Settings →
                    </button>
                  {/if}
                </div>

                <div class="space-y-2">
                  {#each declaredPreferences as pref}
                    <div class="preference-item">
                      <div class="flex items-center justify-between">
                        <span class="text-label font-medium text-[var(--text-primary)]">
                          {pref.title || pref.name}
                        </span>
                        <Badge text={pref.type} variant="default" mono />
                      </div>
                      {#if pref.description}
                        <p class="text-caption text-[var(--text-secondary)] mt-1">
                          {pref.description}
                        </p>
                      {/if}
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
          </div>

          <!-- Right Column: Meta & Versions -->
          <div class="space-y-8">
            {#if listedPermissions.length > 0}
              <section
                class="bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--separator)]"
              >
                <h3 class="text-section mb-6">Permissions</h3>
                <PermissionList
                  permissions={listedPermissions}
                  permissionArgs={manifest?.permissionArgs ?? {}}
                />
              </section>
            {/if}

            <section
              class="bg-[var(--bg-secondary)] rounded-2xl p-6 border border-[var(--separator)]"
            >
              <h3 class="text-section mb-6">Details</h3>

              <dl class="space-y-4 text-caption">
                <div
                  class="flex justify-between items-center pb-3 border-b border-[var(--separator)]"
                >
                  <dt class="text-[var(--text-secondary)] font-medium">Version</dt>
                  <dd class="font-semibold text-[var(--text-primary)]">
                    {extensionDetail?.version || '1.0.0'}
                  </dd>
                </div>
                <div
                  class="flex justify-between items-center pb-3 border-b border-[var(--separator)]"
                >
                  <dt class="text-[var(--text-secondary)] font-medium">Updated</dt>
                  <dd class="font-semibold text-[var(--text-primary)]">
                    {extensionDetail?.updatedAt
                      ? new Date(extensionDetail.updatedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Unknown'}
                  </dd>
                </div>
                <div
                  class="flex justify-between items-center pb-3 border-b border-[var(--separator)]"
                >
                  <dt class="text-[var(--text-secondary)] font-medium">Status</dt>
                  <dd
                    class="font-semibold flex items-center gap-1.5 align-middle"
                    style="color: var(--accent-success);"
                  >
                    <StatusDot color="success" />
                    {extensionDetail?.status}
                  </dd>
                </div>
                <div class="flex justify-between items-center pb-1">
                  <dt class="text-[var(--text-secondary)] font-medium">Added</dt>
                  <dd class="font-semibold text-[var(--text-primary)]">
                    {extensionDetail?.createdAt
                      ? new Date(extensionDetail.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Unknown'}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </div>
    {:else}
      <EmptyState message={t('features.store.details_not_found')} />
    {/if}
  </div>
</div>

<style>
  .detail-accent-strip {
    height: 3px;
    width: 100%;
    flex-shrink: 0;
  }

  .command-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    transition: background var(--dur-instant) var(--ease-travel);
  }

  .command-card:hover {
    background: var(--bg-hover);
  }

  .command-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .command-icon {
    font-size: var(--font-size-lg);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .arg-chip {
    display: inline-block;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .preference-item {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
  }

  .preferences-link {
    font-size: var(--font-size-xs);
    color: var(--accent-primary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: opacity var(--dur-instant) var(--ease-travel);
  }

  .preferences-link:hover {
    opacity: 0.8;
    text-decoration: underline;
  }
</style>
