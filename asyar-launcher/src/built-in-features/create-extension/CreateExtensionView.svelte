<script lang="ts">
  import { onMount } from "svelte";
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { generateExtension } from "./scaffoldService";
  import { logService } from "../../services/log/logService";

  let extName = $state("");
  let extId = $state("");
  let extDesc = $state("");
  let saveLocation = $state("");
  let finalSaveLocation = $derived(saveLocation && extId ? `${saveLocation}/${extId}` : "");

  let isBrowsing = $state(false);
  let isGenerating = $state(false);
  let generateStatus = $state("");

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
      logService.error(`Dialog error: ${e}`);
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
        location: finalSaveLocation,
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
        const { ExtensionManagerProxy } = await import("asyar-sdk");
        await new ExtensionManagerProxy().reloadExtensions();
      } catch (err) {
        logService.error(`Failed to trigger reload: ${err}`);
      }
    } catch (e: any) {
      generateStatus = `Error: ${e.message || String(e)}`;
      isGenerating = false;
    }
  }

  // Pre-fill ID based on Name dynamically if empty
  $effect(() => {
    if (extName && !extId.includes(".")) {
       const suggestion = `com.example.${extName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
       // Only auto format if the user hasn't explicitly typed dots yet
       if (extId === "" || suggestion.startsWith(extId)) {
        // extId = suggestion; // Left optional for now to avoid annoyance
       }
    }
  });

  let idError = $derived(extId && !/^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+$/.test(extId) ? "ID must be dot-notation format (e.g., com.author.extensionname)" : "");
  let nameError = $derived(extName && (extName.length < 2 || extName.length > 50) ? "Name must be between 2 and 50 characters" : "");
  let descError = $derived(extDesc && (extDesc.length < 10 || extDesc.length > 200) ? "Description must be between 10 and 200 characters" : "");
  
  let isValidForm = $derived(!idError && !nameError && !descError && extName && extId && finalSaveLocation && (!extDesc || extDesc.length >= 10));

  function handleFocus() {
    window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, window.location.origin);
  }

  function handleBlur() {
    window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, window.location.origin);
  }
</script>

<div class="view-container p-6 max-w-2xl mx-auto gap-6">
  <div class="flex flex-col gap-1">
    <h1 class="text-page-title">Create Extension</h1>
    <p class="text-subtitle">Scaffold a new Asyar extension project automatically.</p>
  </div>

  <div class="flex flex-col gap-4">
    <!-- Extension Name -->
    <div class="flex flex-col gap-1">
      <label for="extName" class="section-header">Extension Name</label>
      <input 
        id="extName"
        type="text" 
        bind:value={extName} 
        placeholder="My Awesome Tool" 
        autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"
        onfocus={handleFocus}
        onblur={handleBlur}
        class="field-input" style={nameError ? 'border-color: var(--accent-danger)' : ''}
      />
      {#if nameError}<span class="text-caption" style="color: var(--accent-danger)">{nameError}</span>{/if}
    </div>

    <!-- Extension ID -->
    <div class="flex flex-col gap-1">
      <label for="extId" class="section-header">Extension ID (Unique Identifier)</label>
      <input 
        id="extId"
        type="text" 
        bind:value={extId} 
        placeholder="com.myname.awesome-tool" 
        autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"
        onfocus={handleFocus}
        onblur={handleBlur}
        class="field-input text-mono" style={idError ? 'border-color: var(--accent-danger)' : ''}
      />
      {#if idError}<span class="text-caption" style="color: var(--accent-danger)">{idError}</span>{/if}
    </div>

    <!-- Description -->
    <div class="flex flex-col gap-1">
      <label for="extDesc" class="section-header">Description (Optional)</label>
      <input 
        id="extDesc"
        type="text" 
        bind:value={extDesc} 
        placeholder="What does your extension do? (10-200 chars)" 
        autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"
        onfocus={handleFocus}
        onblur={handleBlur}
        class="field-input" style={descError ? 'border-color: var(--accent-danger)' : ''}
      />
      {#if descError}<span class="text-caption" style="color: var(--accent-danger)">{descError}</span>{/if}
    </div>

    <!-- Save Location -->
    <div class="flex flex-col gap-1">
      <label for="saveLocation" class="section-header">Location</label>
      <div class="flex gap-2">
        <input 
          id="saveLocation"
          type="text" 
          value={finalSaveLocation || saveLocation} 
          readonly
          placeholder="Select a parent folder..." 
          onfocus={handleFocus}
          onblur={handleBlur}
          class="flex-1 field-input text-mono opacity-80 cursor-not-allowed"
        />
        <button 
          onclick={handleBrowse}
          disabled={isBrowsing}
          class="btn-secondary"
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
      onclick={handleCreate}
      disabled={!isValidForm || isGenerating}
      class="btn-primary"
    >
      {isGenerating ? 'Creating...' : 'Create Scaffold'}
    </button>
  </div>
</div>
