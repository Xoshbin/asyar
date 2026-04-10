<script lang="ts">
  import {
    SettingsSection,
    Toggle,
    EmptyState,
    LoadingState,
    Badge,
  } from "../../../components";
  import type { SettingsHandler } from "../settingsHandlers.svelte";
  import { extensionStateManager } from "../../../services/extension/extensionStateManager.svelte";
  import { extensionUpdateService } from "../../../services/extension/extensionUpdateService.svelte";
  import { settingsService } from "../../../services/settings/settingsService.svelte";
  import {
    showOpenExtensionDialog,
    installExtensionFromFile,
  } from "../../../lib/ipc/commands";
  import ShellTrustManager from "../../../components/settings/ShellTrustManager.svelte";
  import ScheduledTasksSection from "../../../components/settings/ScheduledTasksSection.svelte";

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let updateCount = $derived(extensionUpdateService.updateCount);
  let isUpdatingAll = $derived(extensionUpdateService.isUpdatingAll);
  let autoUpdate = $derived(
    settingsService.currentSettings.extensions?.autoUpdate !== false,
  );

  async function toggleAutoUpdate() {
    const newValue = !autoUpdate;
    await settingsService.updateSettings("extensions", {
      ...settingsService.currentSettings.extensions,
      autoUpdate: newValue,
    });
  }

  async function handleUpdateExtension(extensionId: string) {
    const update = extensionUpdateService.getUpdateForExtension(extensionId);
    if (!update) return;
    await extensionUpdateService.updateSingle(update, async () =>
      handler.loadExtensions(),
    );
  }

  async function handleUpdateAll() {
    await extensionUpdateService.updateAll(async () =>
      handler.loadExtensions(),
    );
  }

  let isInstallingFromFile = $state(false);
  let installMessage = $state("");
  let installError = $state(false);

  async function handleInstallFromFile() {
    try {
      const filePath = await showOpenExtensionDialog();
      if (!filePath) return;

      isInstallingFromFile = true;
      installMessage = "Installing extension...";
      installError = false;

      await installExtensionFromFile(filePath);

      installMessage = "Extension installed successfully. Restart to activate.";
      // Refresh extension list if handler supports it
      if (handler.loadExtensions) await handler.loadExtensions();
    } catch (error) {
      installError = true;
      installMessage = `Installation failed: ${error}`;
    } finally {
      isInstallingFromFile = false;
      setTimeout(() => {
        installMessage = "";
        installError = false;
      }, 5000);
    }
  }
</script>

<SettingsSection title="Installed Extensions">
  <div class="p-6">
    <!-- Auto-update toggle -->
    <div
      class="flex items-center justify-between mb-4 p-3 rounded-lg"
      style="background: var(--bg-secondary);"
    >
      <div>
        <div class="font-medium text-sm text-[var(--text-primary)]">
          Automatic Updates
        </div>
        <div class="text-xs text-[var(--text-secondary)]">
          Extensions update silently in the background
        </div>
      </div>
      <Toggle checked={autoUpdate} onchange={toggleAutoUpdate} />
    </div>
    <div class="flex items-center justify-between mb-4 px-6">
      <button
        class="text-sm px-4 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
        onclick={handleInstallFromFile}
        disabled={isInstallingFromFile}
      >
        {isInstallingFromFile ? "Installing..." : "Install from File..."}
      </button>
    </div>

    {#if installMessage}
      <div
        class="mb-4 mx-6 p-3 rounded-lg text-sm"
        style="background: color-mix(in srgb, {installError
          ? 'var(--accent-danger)'
          : 'var(--accent-success)'} 12%, transparent); color: {installError
          ? 'var(--accent-danger)'
          : 'var(--accent-success)'};"
      >
        {installMessage}
      </div>
    {/if}

    {#if handler.isLoadingExtensions}
      <LoadingState message="Loading extensions..." />
    {:else if handler.extensionError}
      <EmptyState
        message="Failed to load extensions"
        description={handler.extensionError}
      >
        {#snippet icon()}
          <span class="text-4xl opacity-50">⚠️</span>
        {/snippet}
        <button
          class="btn-secondary mt-4"
          onclick={() => handler.loadExtensions()}>Retry</button
        >
      </EmptyState>
    {:else if handler.extensions.length === 0}
      <EmptyState
        message="No extensions installed"
        description="Extensions add new functionality to Asyar"
      />
      {#if import.meta.env?.DEV}
        <p
          class="mt-4 p-2 rounded text-xs"
          style="background: color-mix(in srgb, var(--accent-warning) 12%, transparent); color: var(--accent-warning);"
        >
          Debug: Extensions array is empty
        </p>
      {/if}
    {:else}
      <!-- Debug info in development -->
      {#if import.meta.env?.DEV}
        <div
          class="mb-4 p-2 rounded text-xs"
          style="background: color-mix(in srgb, var(--accent-primary) 12%, transparent); color: var(--accent-primary);"
        >
          {handler.extensions.length} extensions installed
        </div>
      {/if}

      {#if handler.saveMessage}
        <div
          class="mb-4 p-3 rounded"
          style="background: color-mix(in srgb, {handler.saveError
            ? 'var(--accent-danger)'
            : 'var(--accent-success)'} 12%, transparent); color: {handler.saveError
            ? 'var(--accent-danger)'
            : 'var(--accent-success)'};"
        >
          {handler.saveMessage}
        </div>
      {/if}

      {#if updateCount > 0}
        <div
          class="mb-4 p-3 rounded-lg flex items-center justify-between"
          style="background: color-mix(in srgb, var(--accent-warning) 12%, transparent);"
        >
          <span class="text-sm font-medium text-[var(--text-primary)]">
            {updateCount} extension{updateCount === 1 ? "" : "s"} can be updated
          </span>
          <button
            class="btn-primary text-sm px-4 py-1.5"
            onclick={handleUpdateAll}
            disabled={isUpdatingAll}
          >
            {isUpdatingAll ? "Updating..." : "Update All"}
          </button>
        </div>
      {/if}

      <div class="grid gap-4">
        {#each handler.extensions as extension}
          <div
            class="p-4 border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          >
            <div class="flex items-start">
              <div
                class="w-10 h-10 rounded-md bg-[var(--bg-secondary)] flex items-center justify-center mr-4 flex-shrink-0"
              >
                {#if extension.iconUrl}
                  <img
                    src={extension.iconUrl}
                    alt={extension.title}
                    class="w-6 h-6"
                  />
                {:else}
                  <div class="text-lg text-[var(--text-secondary)]">
                    {extension.title ? extension.title[0].toUpperCase() : "E"}
                  </div>
                {/if}
              </div>
              <div class="flex-1">
                <div class="flex items-center justify-between">
                  <div class="font-medium text-[var(--text-primary)]">
                    {extension.title}
                  </div>
                  {#if extension.version}
                    <Badge text="v{extension.version}" variant="default" mono />
                  {/if}
                  {#if extension.id !== undefined && extensionUpdateService.getUpdateForExtension(extension.id)}
                    <Badge text="Update Available" variant="warning" mono />
                  {/if}
                </div>
                <div class="text-sm text-[var(--text-secondary)] mt-1">
                  {extension.subtitle || "No description available"}
                </div>
                {#if extension.type}
                  <div class="mt-2 flex items-center gap-2">
                    <Badge text={extension.type} variant="default" />

                    {#if extension.compatibility?.status === "sdkMismatch"}
                      <Badge
                        text="⚠️ Requires SDK {extension.compatibility
                          .required}"
                        variant="danger"
                      />
                    {/if}

                    {#if extension.compatibility?.status === "appVersionTooOld"}
                      <Badge
                        text="⚠️ Requires app v{extension.compatibility
                          .required}+"
                        variant="danger"
                      />
                    {/if}

                    {#if extension.compatibility?.status === "platformNotSupported"}
                      <Badge
                        text="⚠️ {extension.compatibility
                          .platform} not supported"
                        variant="danger"
                      />
                    {/if}
                  </div>
                {/if}
              </div>

              <!-- Extension actions -->
              <div class="ml-4 flex flex-col items-end">
                <div class="flex items-center gap-2">
                  {#if extension.id && extensionUpdateService.getUpdateForExtension(extension.id)}
                    <button
                      class="text-xs hover:underline"
                      style="color: var(--accent-warning)"
                      onclick={() =>
                        extension.id && handleUpdateExtension(extension.id)}
                      disabled={extension.id
                        ? extensionUpdateService.isExtensionUpdating(
                            extension.id,
                          )
                        : false}
                    >
                      {extension.id &&
                      extensionUpdateService.isExtensionUpdating(extension.id)
                        ? "Updating..."
                        : "Update"}
                    </button>
                  {/if}

                  <Toggle
                    checked={extension.enabled === true}
                    disabled={handler.togglingExtension === extension.title ||
                      extensionStateManager.extensionUninstallInProgress ===
                        extension.id ||
                      (extension.compatibility?.status !== "compatible" &&
                        extension.compatibility?.status !== "unknown")}
                    onchange={() => handler.toggleExtension(extension)}
                  />

                  <!-- Uninstall button -->
                  <button
                    class="text-xs hover:underline"
                    style="color: var(--accent-danger)"
                    onclick={() => handler.requestUninstallExtension(extension)}
                    disabled={extensionStateManager.extensionUninstallInProgress ===
                      extension.id}
                  >
                    {extensionStateManager.extensionUninstallInProgress ===
                    extension.id
                      ? "Uninstalling..."
                      : "Uninstall"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="mt-6 text-sm text-[var(--text-tertiary)]">
        <p>Extension changes will take effect after restarting Asyar.</p>
      </div>
    {/if}
  </div>
</SettingsSection>

<ScheduledTasksSection />

<ShellTrustManager />
