<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { generateExtension } from "./scaffoldService";

  let extName = "";
  let extId = "";
  let extDesc = "";
  let saveLocation = "";

  let isBrowsing = false;
  let isGenerating = false;
  let generateStatus = "";

  async function handleBrowse() {
    isBrowsing = true;
    try {
      await invoke("set_focus_lock", { locked: true });
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Extension Save Location"
      });
      if (selectedPath && typeof selectedPath === 'string') {
        saveLocation = selectedPath;
      }
    } catch (e) {
      console.error("Dialog error", e);
    } finally {
      await invoke("set_focus_lock", { locked: false });
      isBrowsing = false;
    }
  }

  async function handleCreate() {
    if (!extName || !extId || !saveLocation) return;
    
    isGenerating = true;
    generateStatus = "Initializing scaffold...";
    
    try {
      await generateExtension({
        name: extName,
        id: extId,
        description: extDesc || "An Asyar extension.",
        location: saveLocation,
        onProgress: (status) => {
           generateStatus = status;
        }
      });
      // Small delay so user sees "Done!" before form might ideally reset
      setTimeout(() => {
        isGenerating = false;
        generateStatus = "Generated successfully!";
      }, 1500);

      // Trigger extension reload so it discovers the new extension instantly 
      try {
        const { ExtensionManagerProxy } = await import("asyar-sdk/dist/services/ExtensionManagerProxy");
        await new ExtensionManagerProxy().reloadExtensions();
      } catch (err) {
        console.error("Failed to trigger reload:", err);
      }
    } catch (e: any) {
      generateStatus = `Error: ${e.message || String(e)}`;
      isGenerating = false;
    }
  }

  // Pre-fill ID based on Name dynamically if empty
  $: {
    if (extName && !extId.includes(".")) {
       const suggestion = `com.example.${extName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
       // Only auto format if the user hasn't explicitly typed dots yet
       if (extId === "" || suggestion.startsWith(extId)) {
        // extId = suggestion; // Left optional for now to avoid annoyance
       }
    }
  }
</script>

<div class="p-6 max-w-2xl mx-auto flex flex-col gap-6 text-[var(--text-primary)]">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-bold">Create Extension</h1>
    <p class="text-sm opacity-70">Scaffold a new Asyar extension project automatically.</p>
  </div>

  <div class="flex flex-col gap-4">
    <!-- Extension Name -->
    <div class="flex flex-col gap-1">
      <label for="extName" class="text-xs font-semibold uppercase tracking-wider opacity-60">Extension Name</label>
      <input 
        id="extName"
        type="text" 
        bind:value={extName} 
        placeholder="My Awesome Tool" 
        on:focus={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, '*')}
        on:blur={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, '*')}
        class="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 outline-none focus:border-[var(--accent-color)]"
      />
    </div>

    <!-- Extension ID -->
    <div class="flex flex-col gap-1">
      <label for="extId" class="text-xs font-semibold uppercase tracking-wider opacity-60">Extension ID (Unique Identifier)</label>
      <input 
        id="extId"
        type="text" 
        bind:value={extId} 
        placeholder="com.myname.awesome-tool" 
        on:focus={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, '*')}
        on:blur={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, '*')}
        class="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 outline-none focus:border-[var(--accent-color)] font-mono text-sm"
      />
    </div>

    <!-- Description -->
    <div class="flex flex-col gap-1">
      <label for="extDesc" class="text-xs font-semibold uppercase tracking-wider opacity-60">Description (Optional)</label>
      <input 
        id="extDesc"
        type="text" 
        bind:value={extDesc} 
        placeholder="What does your extension do?" 
        on:focus={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, '*')}
        on:blur={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, '*')}
        class="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 outline-none focus:border-[var(--accent-color)]"
      />
    </div>

    <!-- Save Location -->
    <div class="flex flex-col gap-1">
      <label for="saveLocation" class="text-xs font-semibold uppercase tracking-wider opacity-60">Location</label>
      <div class="flex gap-2">
        <input 
          id="saveLocation"
          type="text" 
          bind:value={saveLocation} 
          readonly
          placeholder="Select a folder..." 
          on:focus={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, '*')}
          on:blur={() => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, '*')}
          class="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded px-3 py-2 outline-none opacity-80 cursor-not-allowed font-mono text-xs"
        />
        <button 
          on:click={handleBrowse}
          disabled={isBrowsing}
          class="bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-color)] rounded px-4 py-2 transition disabled:opacity-50"
        >
          Browse...
        </button>
      </div>
    </div>
  </div>

  <!-- Actions -->
  <div class="flex items-center justify-between pt-4 mt-2 border-t border-[var(--border-color)]">
    <div class="text-sm opacity-80">
      {#if isGenerating}
        <span class="animate-pulse">{generateStatus}</span>
      {:else if generateStatus}
        <span>{generateStatus}</span>
      {/if}
    </div>
    
    <button 
      on:click={handleCreate}
      disabled={!extName || !extId || !saveLocation || isGenerating}
      class="bg-blue-600 hover:bg-blue-500 text-white font-medium rounded px-6 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isGenerating ? 'Creating...' : 'Create Scaffold'}
    </button>
  </div>
</div>
