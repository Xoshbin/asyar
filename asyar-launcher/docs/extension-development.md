# Asyar Extension Development Guide

This guide will help you create new extensions for the Asyar application.

## Table of Contents

- [Extension Structure](#extension-structure)
- [Creating a New Extension](#creating-a-new-extension)
- [Extension Types](#extension-types)
- [UI Components](#ui-components)
- [Search Integration](#search-integration)
- [Example Extensions](#example-extensions)
- [Direct Search Results](#direct-search-results)

## Extension Structure

Each extension must follow this directory structure:

```
src/extensions/your-extension-name/
├── index.ts          # Main extension code
├── manifest.json     # Extension metadata
├── YourView.svelte   # (For view extensions)
└── state.ts          # (Optional) State management
```

### manifest.json

The manifest file defines your extension's metadata and commands:

```json
{
  "name": "your-extension-name",
  "version": "1.0.0",
  "description": "What your extension does",
  "type": "result" | "view",
  "searchable": true | false,  // Whether search works in your view
  "commands": [
    {
      "name": "command-name",
      "description": "What the command does",
      "trigger": "trigger-text"
    }
  ]
}
```

> **Important:** The `name` field in manifest.json should match your extension's directory name.

### index.ts

The main extension file must export a default Extension object:

```typescript
import type { Extension, ExtensionResult } from "../../types/extension";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    // Direct search for "tauri something" queries
    if (query.toLowerCase().startsWith("tauri ")) {
      const searchTerm = query.substring("tauri ".length).trim();

      // Search the documentation
      const results = await searchDocs(searchTerm);

      // Only show the top 5 most relevant results
      return results.slice(0, 5).map((doc) => ({
        title: doc.title,
        subtitle: doc.description,
        type: "result",
        action: async () => {
          await ExtensionApi.window.hide();
          await openUrl(doc.url);
        },
      }));
    }

    // For just "tauri", show the option to open the full view
    if (query.toLowerCase() === "tauri") {
      return [
        {
          title: "Tauri Documentation",
          subtitle: "Browse the official Tauri documentation",
          type: "view",
          action: () =>
            ExtensionApi.navigation.setView("tauri-docs", "TauriDocsView"),
        },
      ];
    }

    return [];
  },

  // Optional: Handle searches within your view
  async onViewSearch?(query: string): Promise<void> {
    // Update your view based on search query
  },
};

export default extension;
```

## Creating a New Extension

1. Create a new directory in `src/extensions/` (use kebab-case)
2. Create your manifest.json (name should match directory name)
3. Implement your extension logic in index.ts
4. For view extensions, create a Svelte component
5. (Optional) Add state.ts for state management

## Extension API

Extensions have access to the ExtensionApi class which provides safe interfaces to system functionality:

```typescript
import { ExtensionApi } from "../../api/extensionApi";

// Clipboard operations
await ExtensionApi.clipboard.readText();
await ExtensionApi.clipboard.writeText("Hello");
await ExtensionApi.clipboard.readImage();
await ExtensionApi.clipboard.writeImage(base64String);
await ExtensionApi.clipboard.simulatePaste();

// Window operations
await ExtensionApi.window.hide();
await ExtensionApi.window.show();

// Application operations
await ExtensionApi.apps.list();
await ExtensionApi.apps.open("/path/to/app");

// Navigation
ExtensionApi.navigation.setView("extension-id", "ViewName");

// Logging
ExtensionApi.log.debug("Debug message");
ExtensionApi.log.info("Info message");
ExtensionApi.log.error("Error message");
```

## UI Components

Asyar provides several built-in UI components to maintain a consistent look and feel across extensions.

### Importing Components

To use these components in your Svelte files, import them from the built-in components package:

```svelte
<script lang="ts">
  import { Button, Input, ResultsList, SplitView } from "../../components";
</script>
```

### Basic Components

#### Button

A standard button component with consistent styling.

```svelte
<!-- Basic usage -->
<Button on:click={handleClick}>Click Me</Button>

<!-- Full width button -->
<Button fullWidth on:click={handleSubmit}>Submit</Button>

<!-- Disabled state -->
<Button disabled={isLoading}>Save</Button>
```

Example from GreetingView.svelte:

```svelte
<Button fullWidth on:click={handleSubmit}>
  Greet Me
</Button>
```

#### Input

A standard input component for text entry.

```svelte
<!-- Basic usage -->
<Input bind:value={inputValue} placeholder="Enter text" />

<!-- Handling events -->
<Input
  bind:value={searchText}
  placeholder="Search..."
  on:input={handleSearch}
/>

<!-- Disabled state -->
<Input disabled={isLoading} value={fixedValue} />
```

Example from GreetingView.svelte:

```svelte
<Input
  bind:value={name}
  placeholder="Enter your name"
/>
```

### Layout Components

#### SplitView

A resizable split panel layout with left and right sections.

```svelte
<SplitView
  leftWidth={300}  <!-- Initial width of left panel in pixels -->
  minLeftWidth={200}  <!-- Minimum width when resizing -->
  maxLeftWidth={600}  <!-- Maximum width when resizing -->
>
  <div slot="left">
    <!-- Left panel content -->
  </div>

  <div slot="right">
    <!-- Right panel content -->
  </div>
</SplitView>
```

Example from ClipboardHistory.svelte:

```svelte
<SplitView leftWidth={300} minLeftWidth={200} maxLeftWidth={600}>
  <div slot="left" class="h-full">
    <!-- List of clipboard items -->
  </div>

  <div slot="right" class="h-full flex flex-col overflow-hidden">
    <!-- Selected item details -->
  </div>
</SplitView>
```

### List Components

#### ResultsList

A standardized list for displaying search results or other selectable items.

```svelte
<ResultsList
  items={[
    {
      title: "Item title",
      subtitle: "Optional subtitle",
      action: () => console.log("Item clicked")
    }
  ]}
  selectedIndex={0}  <!-- Index of selected item (for highlighting) -->
  on:select={({ detail }) => detail.item.action()}
/>
```

Example from +page.svelte:

```svelte
<!-- Transform items for ResultsList -->
$: extensionItems = $searchResults.extensions.map(result => ({
  title: result.title,
  subtitle: result.subtitle,
  action: result.action
}));

<!-- In the template -->
<ResultsList
  items={extensionItems}
  selectedIndex={$searchResults.selectedIndex}
  on:select={({ detail }) => detail.item.action()}
/>
```

### Best Practices

1. **Use the built-in components** whenever possible to maintain a consistent look and feel across extensions.

2. **Leverage reactive statements** with the components:

   ```svelte
   $: filteredItems = searchQuery
     ? allItems.filter(item => item.title.includes(searchQuery))
     : allItems;

   <ResultsList items={filteredItems} ... />
   ```

3. **Handle keyboard navigation** properly:

   ```svelte
   function handleKeydown(event: KeyboardEvent) {
     if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
       // Update selectedIndex
     }
   }
   ```

4. **Use CSS variables** for consistent styling:

   ```svelte
   <div class="bg-[var(--bg-selected)] text-[var(--text-primary)]">
     Content with theme variables
   </div>
   ```

5. **Apply custom scrollbars** for a consistent scrolling experience:
   ```svelte
   <div class="custom-scrollbar max-h-80">
     Scrollable content
   </div>
   ```

## Extension Types

### Result Extension

Returns immediate results in the search list.

```typescript
// Example result extension
const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    return [
      {
        title: "Result Title",
        subtitle: "Optional subtitle",
        type: "result",
        action: async () => {
          await ExtensionApi.clipboard.writeText("Some text");
          await ExtensionApi.window.hide();
        },
      },
    ];
  },
};
```

### View Extension

Opens a new view when selected.

```typescript
// Example view extension
const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    return [
      {
        title: "Open View",
        subtitle: "Click to open",
        type: "view",
        action: () => {
          return ExtensionApi.navigation.setView(
            "extension-name",
            "ViewComponent"
          );
        },
      },
    ];
  },
};
```

For view extensions, create a Svelte component with this structure:

```svelte
<!-- YourView.svelte -->
<script lang="ts">
  import extensionManager from '../../services/extensionManager';
</script>

<div class="h-[calc(100vh-72px)] overflow-y-auto">
  <div class="p-8">
    <button
      class="mb-4 text-gray-400 hover:text-white"
      on:click={() => extensionManager.closeView()}>
      ← Back to search
    </button>

    <!-- Your view content -->
  </div>
</div>
```

## Search Integration

Extensions can integrate with the app's search functionality in two ways:

1. **Global Search**: When users type in the main search bar, the `search()` method is called
2. **View Search**: When users type while in an extension's view, the `onViewSearch()` method is called

### Making Views Searchable

To enable search within your extension's view:

1. Set `searchable: true` in your manifest.json
2. Implement the `onViewSearch` method in your extension

```typescript
// Example searchable view extension
import { viewState } from "./state";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    // Standard search handling
    // ...
  },

  async onViewSearch(query: string): Promise<void> {
    // Update your view based on the search query
    viewState.setSearch(query);
  },
};
```

### Extension State Management

For searchable views, create a state.ts file to handle search state:

```typescript
// state.ts
import { writable } from "svelte/store";

function createViewState() {
  const { subscribe, set, update } = writable({
    searchQuery: "",
    filtered: false,
  });

  return {
    subscribe,
    setSearch: (query: string) =>
      update((state) => ({
        ...state,
        searchQuery: query,
        filtered: query.length > 0,
      })),
  };
}

export const viewState = createViewState();
```

Then in your view component, subscribe to the state:

```svelte
<script>
  import { viewState } from "./state";

  // Filter your items based on search
  $: filteredItems = $viewState.searchQuery
    ? allItems.filter(item =>
        item.content.toLowerCase().includes($viewState.searchQuery.toLowerCase())
      )
    : allItems;
</script>
```

## Example Extensions

### Clipboard History Extension

A searchable view extension that shows clipboard history:

```typescript
// index.ts
import type { Extension, ExtensionResult } from "../../types/extension";
import { ExtensionApi } from "../../api/extensionApi";
import { clipboardViewState } from "./state";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("cl")) {
      return [
        {
          title: "Clipboard History",
          subtitle: "View and manage your clipboard history",
          type: "view",
          action: () => {
            return ExtensionApi.navigation.setView(
              "clipboard-history",
              "ClipboardHistory"
            );
          },
        },
      ];
    }
    return [];
  },

  async onViewSearch(query: string) {
    clipboardViewState.setSearch(query);
  },
};

export default extension;
```

```json
// manifest.json
{
  "name": "clipboard-history",
  "version": "1.0.0",
  "description": "Manage and access your clipboard history",
  "type": "view",
  "searchable": true,
  "commands": [
    {
      "name": "clipboard-history",
      "description": "Show clipboard history",
      "trigger": "clip"
    }
  ]
}
```

### Greeting Extension

A simple non-searchable view extension:

```typescript
// index.ts
import type { Extension, ExtensionResult } from "../../types/extension";
import extensionManager from "../../services/extensionManager";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("gr")) {
      return [
        {
          title: "Greeting Form",
          subtitle: "Open greeting form",
          type: "view",
          viewPath: "greeting/GreetingView",
          action: () =>
            extensionManager.navigateToView("greeting/GreetingView"),
        },
      ];
    }
    return [];
  },
};

export default extension;
```

```json
// manifest.json
{
  "name": "greeting",
  "version": "1.0.0",
  "description": "Simple greeting form",
  "type": "view",
  "searchable": false,
  "commands": [
    {
      "name": "greeting",
      "description": "Open greeting form",
      "trigger": "gr"
    }
  ]
}
```

### Calculator Extension

A result extension that evaluates mathematical expressions:

```typescript
// index.ts
import type { Extension, ExtensionResult } from "../../types/extension";
import { ExtensionApi } from "../../api/extensionApi";
import { evaluate } from "mathjs";

// Helper to check if string contains mathematical expression
function isMathExpression(query: string): boolean {
  // Match expressions with numbers, operators, and parentheses
  return /^[\d\s+\-*/()\^.]+$/.test(query) && /\d/.test(query);
}

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    ExtensionApi.log.debug(`Calculator checking expression: "${query}"`);

    if (isMathExpression(query)) {
      try {
        const result = evaluate(query);
        return [
          {
            title: `${query} = ${result}`,
            subtitle: "Press Enter to copy to clipboard",
            type: "result",
            action: async () => {
              await ExtensionApi.clipboard.writeText(result.toString());
              ExtensionApi.log.info(`Copied result: ${result}`);
              await ExtensionApi.window.hide();
            },
          },
        ];
      } catch (error) {
        ExtensionApi.log.debug(`Calculator error: ${error}`);
        // ... error handling ...
      }
    }
    return [];
  },
};

export default extension;
```

```json
// manifest.json
{
  "name": "calculator",
  "version": "1.0.0",
  "description": "Evaluate mathematical expressions",
  "type": "result",
  "searchable": false,
  "commands": [
    {
      "name": "calculate",
      "description": "Calculate mathematical expressions",
      "trigger": ""
    }
  ]
}
```

This extension:

1. Detects mathematical expressions as they're typed
2. Shows results immediately in the search list
3. Allows copying the result to clipboard when selected
4. Shows errors for invalid expressions
5. Uses an empty trigger to evaluate all queries (only returns results for math expressions)

## Direct Search Results

You can create extensions that directly display search results in the main search interface without requiring the user to first select your extension. This creates a more seamless experience for users who want immediate access to your extension's functionality.

### How Direct Search Works

When a user types a specific prefix (like "tauri") followed by a search term, your extension can immediately display relevant results in the main search list. The user can then directly select and interact with these results.

### Implementing Direct Search

To implement direct search functionality:

1. Detect and parse the specific prefix in your extension's `search` method
2. Return result items for queries matching your prefix pattern
3. Use descriptive titles and subtitles to make it clear what the results represent

```typescript
async search(query: string): Promise<ExtensionResult[]> {
  // Direct search for "tauri something" queries
  if (query.toLowerCase().startsWith("tauri ")) {
    const searchTerm = query.substring("tauri ".length).trim();

    // Search the documentation
    const results = await searchDocs(searchTerm);

    // Only show the top 5 most relevant results
    return results.slice(0, 5).map(doc => ({
      title: doc.title,
      subtitle: doc.description,
      type: "result",
      action: async () => {
        await ExtensionApi.window.hide();
        await openUrl(doc.url);
      },
    }));
  }

  // For just "tauri", show the option to open the full view
  if (query.toLowerCase() === "tauri") {
    return [{
      title: "Tauri Documentation",
      subtitle: "Browse the official Tauri documentation",
      type: "view",
      action: () => ExtensionApi.navigation.setView("tauri-docs", "TauriDocsView"),
    }];
  }

  return [];
}
```
