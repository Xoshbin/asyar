# Asyar Extension Development Guide

This guide will help you create new extensions for the Asyar application.

## Table of Contents

- [Extension Structure](#extension-structure)
- [Creating a New Extension](#creating-a-new-extension)
- [Extension Types](#extension-types)
- [Example Extensions](#example-extensions)

## Extension Structure

Each extension must follow this directory structure:

```
src/extensions/your-extension-name/
├── index.ts        # Main extension code
├── manifest.json   # Extension metadata
└── package.json    # (Optional) If you need dependencies
```

### manifest.json

The manifest file defines your extension's metadata and commands:

```json
{
  "name": "Your Extension",
  "version": "1.0.0",
  "description": "What your extension does",
  "type": "result" | "view",
  "commands": [
    {
      "name": "command-name",
      "description": "What the command does",
      "trigger": "trigger-text"
    }
  ]
}
```

### index.ts

The main extension file must export a default Extension object:

```typescript
import type { Extension, ExtensionResult } from "../../types/extension";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    // Your search logic here
    return [];
  },
};

export default extension;
```

## Creating a New Extension

1. Create a new directory in `src/extensions/`
2. Create your manifest.json
3. Implement your extension logic in index.ts
4. (Optional) Add package.json if you need dependencies

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
        action: () => {
          // What happens when user selects this result
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
        viewPath: "your-view-name",
        action: () => {
          extensionManager.navigateToView("your-view-name");
        },
      },
    ];
  },
};
```

For view extensions, create a Svelte component in your extension directory:

```svelte
<!-- YourView.svelte -->
<script lang="ts">
  import extensionManager from '../../services/extensionManager';
</script>

<div class="p-8">
  <button on:click={() => extensionManager.closeView()}>
    ← Back
  </button>
  <!-- Your view content -->
</div>
```

## Example Extensions

### Calculator Extension

A result extension that evaluates mathematical expressions:

```typescript
import { evaluate } from "mathjs";

const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (isMathExpression(query)) {
      const result = evaluate(query);
      return [
        {
          title: `${query} = ${result}`,
          subtitle: "Press Enter to copy",
          type: "result",
          action: async () => {
            await navigator.clipboard.writeText(result.toString());
          },
        },
      ];
    }
    return [];
  },
};
```

### Greeting Extension

A view extension that shows an interactive form:

```typescript
const extension: Extension = {
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("gr")) {
      return [
        {
          title: "Greeting Form",
          subtitle: "Open greeting form",
          type: "view",
          viewPath: "greeting",
          action: () => extensionManager.navigateToView("greeting"),
        },
      ];
    }
    return [];
  },
};
```
