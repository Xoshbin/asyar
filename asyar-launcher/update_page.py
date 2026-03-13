import re

with open('src/routes/+page.svelte', 'r') as f:
    content = f.read()

# Replace the dynamic component mounting with ExtensionIframe
old_code = """    {#if $activeView}
       <!-- Container where the view component will be manually mounted -->
      <div bind:this={viewContainerElement} class="min-h-full flex flex-col" data-extension-view={$activeView}>
        {#if $isSearchLoading}
            <div class="p-4 text-center text-[var(--text-secondary)]">Loading View...</div>
        {:else if currentError}
             <!-- Error during component load/instantiation might be shown here or inside the container by the reactive block -->
             <!-- <div class="p-4 text-center text-red-500">{currentError}</div> -->
        {/if}
         <!-- Component instance is created and managed in the reactive block -->
      </div>
    {:else}"""

new_code = """    {#if $activeView}
      <div class="min-h-full flex flex-col flex-1 h-full" data-extension-view={$activeView}>
        <ExtensionIframe
          extensionId={$activeView.split('/')[0]}
          manifest={extensionManager.getManifest($activeView.split('/')[0])}
        />
      </div>
    {:else}"""

content = content.replace(old_code, new_code)

# Add ExtensionIframe import
import_statement = "import ExtensionIframe from '../components/extension/ExtensionIframe.svelte';\n"
content = re.sub(r'(import {.*?from "svelte/store";)', r'\1\n' + import_statement, content, 1)

# Remove dynamic view component mounting logic
content = re.sub(r'\$: if \(\$activeView\) \{[\s\S]*?\} else if \(!viewContainerElement && currentViewInstance\) \{[\s\S]*?currentViewComponentClass = null;\n  \}', '', content)

with open('src/routes/+page.svelte', 'w') as f:
    f.write(content)
