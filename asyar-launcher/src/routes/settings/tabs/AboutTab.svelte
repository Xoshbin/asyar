<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { SettingsSection, SettingsRow, Button, SegmentedControl } from "../../../components";
  import type { SettingsHandler } from "../settingsHandlers.svelte";
  import { check } from "@tauri-apps/plugin-updater";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";

  let {
    handler,
  }: {
    handler: SettingsHandler;
  } = $props();

  let updateStatus = $state<
    | "idle"
    | "checking"
    | "downloading"
    | "available"
    | "up-to-date"
    | "error"
    | "installed"
  >("idle");
  let updateVersion = $state("");
  let updateError = $state("");
  let appVersion = $state("");
  let unlisten: UnlistenFn | null = null;

  let selectedChannel = $state<"stable" | "beta">("stable");
  $effect(() => {
    selectedChannel = handler.settings.updates?.channel ?? "stable";
  });
  $effect(() => {
    const current = handler.settings.updates?.channel ?? "stable";
    if (selectedChannel !== current) {
      handler.updateChannel(selectedChannel as "stable" | "beta");
    }
  });

  onMount(async () => {
    try {
      appVersion = await getVersion();
    } catch {
      appVersion = "0.1.0";
    }

    unlisten = await listen("check-for-updates", () => {
      handler.activeTab = "about";
      checkForUpdates();
    });
  });

  onDestroy(() => {
    unlisten?.();
  });

  async function checkForUpdates() {
    if (updateStatus === "checking" || updateStatus === "downloading") return;

    updateStatus = "checking";
    updateError = "";
    updateVersion = "";

    try {
      const channel = handler.settings.updates?.channel ?? "stable";
      const update = await check({ headers: { "X-Update-Channel": channel } });

      if (update) {
        updateVersion = update.version;
        updateStatus = "available";

        updateStatus = "downloading";
        await update.downloadAndInstall();
        updateStatus = "installed";
      } else {
        updateStatus = "up-to-date";
      }
    } catch (e) {
      updateStatus = "error";
      updateError = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<SettingsSection title="About">
  <div class="p-6">
    <div
      class="flex flex-col items-center justify-center pb-8 mb-8 border-b border-[var(--border-color)]"
    >
      <div
        class="w-24 h-24 rounded-xl mx-auto mb-4 shadow-xl flex items-center justify-center"
      >
        <img src="/src/resources/images/Square142x142Logo.png" alt="" />
      </div>
      <h2 class="text-2xl font-bold mt-4 text-[var(--text-primary)]">Asyar</h2>
      <p class="text-[var(--text-secondary)] mt-2">Version {appVersion}</p>
    </div>

    <SettingsRow
      label="Release channel"
      description="Stable: tested releases only. Beta: early access to pre-release versions."
    >
      <SegmentedControl
        options={[
          { value: "stable", label: "Stable" },
          { value: "beta", label: "Beta" },
        ]}
        bind:value={selectedChannel}
      />
    </SettingsRow>

    <div class="grid md:grid-cols-2 gap-8">
      <div>
        <h3 class="text-lg font-medium mb-3 text-[var(--text-primary)]">
          Description
        </h3>
        <p class="text-[var(--text-secondary)] leading-relaxed">
          Asyar is a lightweight, keyboard-driven application launcher for
          macOS. Find and launch applications quickly with just a few
          keystrokes.
        </p>
      </div>

      <div>
        <h3 class="text-lg font-medium mb-3 text-[var(--text-primary)]">
          Credits
        </h3>
        <p class="text-[var(--text-secondary)] mb-2">
          <strong>Created by:</strong> Khoshbin Ali
        </p>
        <p class="text-[var(--text-secondary)] mb-2">
          <strong>Built with:</strong> Tauri, Rust, Svelte, TypeScript
        </p>
      </div>
    </div>

    {#if updateStatus !== "idle"}
      <div
        class="mt-6 p-4 rounded-lg {updateStatus === 'error'
          ? 'bg-red-500/10 text-red-400'
          : updateStatus === 'up-to-date'
            ? 'bg-green-500/10 text-green-400'
            : updateStatus === 'installed'
              ? 'bg-green-500/10 text-green-400'
              : 'bg-blue-500/10 text-blue-400'}"
      >
        {#if updateStatus === "checking"}
          Checking for updates...
        {:else if updateStatus === "available"}
          Update {updateVersion} is available. Starting download...
        {:else if updateStatus === "downloading"}
          Downloading and installing update {updateVersion}...
        {:else if updateStatus === "installed"}
          Update {updateVersion} installed. Restart Asyar to apply the update.
        {:else if updateStatus === "up-to-date"}
          You're running the latest version.
        {:else if updateStatus === "error"}
          Update check failed: {updateError}
        {/if}
      </div>
    {/if}

    <div class="flex gap-4 mt-8 pt-6 border-t border-[var(--border-color)]">
      <Button
        onclick={checkForUpdates}
        disabled={updateStatus === "checking" || updateStatus === "downloading"}
      >
        {#if updateStatus === "checking" || updateStatus === "downloading"}
          Checking...
        {:else}
          Check for Updates
        {/if}
      </Button>
      <Button
        onclick={() => openUrl("https://github.com/Xoshbin/asyar-launcher")}
      >
        View on GitHub
      </Button>
      <div class="grow"></div>
      <Button>Privacy Policy</Button>
      <Button>License</Button>
    </div>
  </div>
</SettingsSection>
