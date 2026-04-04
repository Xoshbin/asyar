<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import { invoke } from "@tauri-apps/api/core";
  import { generateExtension, type ExtensionType } from "./scaffoldService";
  import { logService } from "../../services/log/logService";
  import { FormField, Icon } from "../../components";

  const typeOptions: { value: ExtensionType; label: string; icon: string; description: string }[] = [
    {
      value: "view",
      icon: "image",
      label: "UI View",
      description: "Full-page Svelte interface opened directly by a command.",
    },
    {
      value: "result",
      icon: "filter",
      label: "Search + View",
      description: "Returns filterable results; clicking one opens a detail view.",
    },
    {
      value: "logic",
      icon: "snippets",
      label: "Action Only",
      description: "Runs logic directly with no UI — appears in search as actionable items.",
    },
    {
      value: "theme",
      icon: "layers",
      label: "Theme",
      description: "Customizes Asyar's appearance with CSS variables. No JavaScript required.",
    },
  ];

  let extType = $state<ExtensionType>("view");
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
        extensionType: extType,
        onProgress: (status) => { generateStatus = status; }
      });

      setTimeout(() => {
        isGenerating = false;
        generateStatus = "Generated successfully!";
      }, 1500);

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

  let idError = $derived(extId && !/^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+$/.test(extId)
    ? "Must use dot-notation format (e.g., com.author.my-tool)" : "");
  let nameError = $derived(extName && (extName.length < 2 || extName.length > 50)
    ? "Must be between 2 and 50 characters" : "");
  let descError = $derived(extDesc && (extDesc.length < 10 || extDesc.length > 200)
    ? "Must be between 10 and 200 characters" : "");

  let isValidForm = $derived(
    !idError && !nameError && !descError &&
    extName && extId && finalSaveLocation &&
    (!extDesc || extDesc.length >= 10)
  );

  function handleFocus() {
    window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, window.location.origin);
  }

  function handleBlur() {
    window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, window.location.origin);
  }
</script>

<div class="view-container">
  <div class="form-body custom-scrollbar">
    <div class="header">
      <h1 class="text-page-title">Create Extension</h1>
      <p class="text-subtitle">Scaffold a new Asyar extension project automatically.</p>
    </div>

    <div class="fields">
      <FormField label="Extension Type">
        <div class="type-grid">
          {#each typeOptions as opt}
            <label class="type-card" class:selected={extType === opt.value}>
              <input
                type="radio"
                name="ext-type"
                value={opt.value}
                checked={extType === opt.value}
                onchange={() => { extType = opt.value; }}
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

      <FormField label="Extension Name" error={nameError}>
        <input
          type="text"
          bind:value={extName}
          placeholder="My Awesome Tool"
          autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"
          onfocus={handleFocus}
          onblur={handleBlur}
          class="field-input"
          class:error={!!nameError}
        />
      </FormField>

      <FormField label="Extension ID" hint="Unique dot-notation identifier — e.g. com.author.my-tool" error={idError}>
        <input
          type="text"
          bind:value={extId}
          placeholder="com.myname.awesome-tool"
          autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"
          onfocus={handleFocus}
          onblur={handleBlur}
          class="field-input text-mono"
          class:error={!!idError}
        />
      </FormField>

      <FormField label="Description" hint="Optional — shown in search results (10–200 chars)" error={descError}>
        <input
          type="text"
          bind:value={extDesc}
          placeholder="What does your extension do?"
          autocapitalize="none" autocomplete="off" autocorrect="off" spellcheck="false"
          onfocus={handleFocus}
          onblur={handleBlur}
          class="field-input"
          class:error={!!descError}
        />
      </FormField>

      <FormField label="Save Location">
        <div class="location-row">
          <input
            type="text"
            value={finalSaveLocation || saveLocation}
            readonly
            placeholder="Select a parent folder..."
            onfocus={handleFocus}
            onblur={handleBlur}
            class="field-input text-mono"
          />
          <button onclick={handleBrowse} disabled={isBrowsing} class="btn-secondary">
            Browse…
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
      {isGenerating ? 'Creating…' : 'Create Scaffold'}
    </button>
  </footer>
</div>

<style>
  .form-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px 24px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
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
    gap: 8px;
  }

  .type-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-md);
    border: 2px solid var(--border-color);
    cursor: pointer;
    transition: border-color var(--transition-fast), background var(--transition-fast);
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
    gap: 3px;
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

  .field-input.error {
    border-color: var(--accent-danger);
  }

  .location-row {
    display: flex;
    gap: 8px;
  }

  .location-row .field-input {
    flex: 1;
    opacity: 0.75;
    cursor: not-allowed;
  }

  .form-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
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
