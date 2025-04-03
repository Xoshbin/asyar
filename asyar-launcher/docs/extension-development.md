# Asyar Extension Development Guide

This guide will help you create new extensions for the Asyar application.

## Table of Contents

- [Extension Structure](#extension-structure)
- [Creating a New Extension](#creating-a-new-extension)
- [Extension API](#extension-api)
- [UI Components](#ui-components)
- [Extension Types](#extension-types)
- [Search Integration](#search-integration)
- [Example Extensions](#example-extensions)
- [Direct Search Results](#direct-search-results)
- [Defining and Handling Commands](#defining-and-handling-commands)
- [Action Handling](#action-handling)

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
      "id": "command-id",
      "name": "Command Name",
      "description": "What the command does",
      "trigger": "trigger-text"
    }
  ]
}
```

> **Important:** The `name` field in manifest.json should match your extension's directory name. The `id` field should be unique within the extension.

### index.ts

The main extension file must export a default Extension class implementation:

```typescript
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types";

class MyExtension implements Extension {
  onUnload: any;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private actionService?: IActionService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.actionService = context.getService<IActionService>("ActionService");
    this.logService?.info("Extension initialized");
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(
      `Executing command ${commandId} with args: ${JSON.stringify(args || {})}`
    );

    switch (commandId) {
      case "my-command":
        const input = args?.input || "";
        return {
          type: "view",
          displayTitle: "Command Result",
          displaySubtitle: `Input was: ${input}`,
        };
      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  viewActivated(viewPath: string) {
    this.inView = true;
    // Register view-specific actions here
  }

  viewDeactivated() {
    // Unregister view-specific actions here
    this.inView = false;
  }

  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().includes("keyword")) {
      return [
        {
          title: "My Result",
          subtitle: "Description of what this does",
          type: "result",
          action: async () => {
            // Action when result is selected
            this.logService?.info("Result selected");
            this.extensionManager?.closeView();
          },
          score: 1,
        },
      ];
    }
    return [];
  }

  async onViewSearch?(query: string): Promise<void> {
    // Update view based on search query
  }

  async activate(): Promise<void> {
    this.logService?.info("Extension activated");
  }

  async deactivate(): Promise<void> {
    this.logService?.info("Extension deactivated");
  }
}

// Create and export a single instance
export default new MyExtension();
```

## Creating a New Extension

1. Create a new directory in `src/extensions/` (use kebab-case)
2. Create your manifest.json (name should match directory name)
3. Implement your extension class in index.ts
4. For view extensions, create a Svelte component
5. (Optional) Add state.ts for state management

## Extension API

Extensions have access to system services through the ExtensionContext parameter passed to the initialize method:

```typescript
async initialize(context: ExtensionContext): Promise<void> {
  // Access services
  this.logService = context.getService<ILogService>("LogService");
  this.extensionManager = context.getService<IExtensionManager>("ExtensionManager");
  this.actionService = context.getService<IActionService>("ActionService");
  this.clipboardService = context.getService<IClipboardHistoryService>("ClipboardHistoryService");
  this.notificationService = context.getService<INotificationService>("NotificationService");

  // Initialize state services (if you have a state file)
  myViewState.initializeServices(context);
}
```

### Available Services

- **LogService**: For logging information, errors, and debugging
- **ExtensionManager**: For navigation and extension management
- **ActionService**: For registering and unregistering actions
- **ClipboardHistoryService**: For accessing clipboard history
- **NotificationService**: For displaying notifications
- **CommandService**: (Internal service, typically not directly used by extensions for command registration)

### Defining and Handling Commands

Commands are defined in your extension's `manifest.json` file and their execution logic is implemented within your extension's `executeCommand` method in `index.ts`. The Asyar `ExtensionManager` automatically handles the registration process during application startup, linking the command definition in the manifest to your implementation.

#### Defining Commands in `manifest.json`

Define your commands in the manifest.json file:

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "description": "My extension description",
  "type": "result",
  "searchable": false,
  "commands": [
    {
      "id": "my-command",
      "name": "My Command",
      "description": "What the command does",
      "trigger": "mc"
    }
  ]
}
```

#### Implementing Command Logic in `index.ts`

The `executeCommand` method in your extension class (`index.ts`) is called when a user triggers one of the commands defined in your `manifest.json`. The `commandId` parameter passed to this method corresponds directly to the `id` field you specified for the command in the manifest.

```typescript
async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
  this.logService?.info(`Executing command ${commandId} with args: ${JSON.stringify(args || {})}`);

  switch (commandId) {
    // 'my-command' matches the 'id' field in manifest.json
    case "my-command":
      const input = args?.input || "";
      // Process the command based on the input or other logic
      this.logService?.info(`'my-command' executed with input: ${input}`);
      // Return a result if needed (e.g., data for a view, or nothing)
      return {
        type: "notification", // Example: Show a notification
        message: `Command executed with input: ${input}`
      };
    // Add cases for other command IDs defined in your manifest
    default:
      // It's good practice to handle unknown command IDs
      this.logService?.error(`Received unknown command ID: ${commandId}`);
      throw new Error(`Unknown command: ${commandId}`);
  }
}
```

### Action Handling

Actions provide context-specific operations accessible via the Action Drawer (⌘K).

#### Registering Actions

Actions are typically registered dynamically when they become relevant. For actions specific to a view, the common pattern is to register them within the `executeCommand` method when the command that navigates to that view is executed.

```typescript
// In executeCommand method, inside the case for the command that opens the view
async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
  switch (commandId) {
    case "show-my-view":
      this.extensionManager?.navigateToView("my-extension/MyView");
      // Register actions associated with MyView
      this.registerMyViewActions();
      return { type: "view", viewPath: "my-extension/MyView" };
    // ... other cases
  }
}

// Helper method to register actions
private registerMyViewActions() {
  if (this.actionService) {
    const myAction: ExtensionAction = {
      id: "my-action-id",
      title: "My View Action",
      description: "Perform an action specific to this view",
      icon: "💡",
      extensionId: "my-extension-id", // Should match your extension's ID
      category: "view-action", // Or another relevant category
      // context: ActionContext.EXTENSION_VIEW, // Context is often inferred by ActionService
      execute: async () => {
        this.logService?.info("My view action executed!");
        // ... action logic
      },
    };
    this.actionService.registerAction(myAction);
    this.logService?.debug("Registered view-specific actions.");
  }
}
```

While `viewActivated` can still be used for view setup logic, action registration is now preferred within `executeCommand` for better control over when actions become available.

#### Unregistering Actions

Actions should be unregistered when they are no longer relevant. For view-specific actions, this is typically done in the `viewDeactivated` method. Ensure you unregister all actions that were registered for that view.

```typescript
// Helper method to unregister actions
private unregisterMyViewActions() {
  if (this.actionService) {
    this.actionService.unregisterAction("my-action-id");
    // Unregister any other actions associated with this view
    this.logService?.debug("Unregistered view-specific actions.");
  }
}

// In viewDeactivated method
async viewDeactivated(viewPath: string): Promise<void> {
  this.unregisterMyViewActions();
  this.inView = false; // Update view status
}

// Also ensure cleanup in deactivate if the extension might be unloaded while the view is active
async deactivate(): Promise<void> {
  if (this.inView) {
    this.unregisterMyViewActions();
  }
  this.logService?.info("Extension deactivated");
}
```

## UI Components

Asyar provides several built-in UI components to maintain a consistent look and feel across extensions.

### Importing Components

To use these components in your Svelte files, import them from the built-in components package:

```svelte
<script lang="ts">
  import { Button, Input, Card, Toggle, ShortcutRecorder, SplitView, ConfirmDialog, ResultsList } from "../../components";
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

#### Card

A container component for grouping related content.

```svelte
<Card>
  <p>This is content inside a card.</p>
</Card>
```

#### Toggle

A toggle switch component for boolean input.

```svelte
<Toggle bind:checked={isChecked}>Enable Feature</Toggle>
```

#### ShortcutRecorder

A component for recording keyboard shortcuts.

```svelte
<ShortcutRecorder bind:shortcut={userShortcut} />
```

#### ConfirmDialog

A modal dialog for confirming actions.

```svelte
<ConfirmDialog
  isOpen={isDialogOpen}
  title="Confirm Delete"
  message="Are you sure you want to delete this item?"
  on:confirm={handleDelete}
  on:cancel={() => isDialogOpen = false}
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
   </div>
   ```

3. **Apply custom scrollbars** for a consistent scrolling experience:
   ```svelte
   <div class="custom-scrollbar max-h-80">
     Scrollable content
   </div>
   ```

## Extension Types

### Class-based Extension Structure

All extensions should follow this basic structure:

```typescript
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types";

class MyExtension implements Extension {
  onUnload: any;
  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private actionService?: IActionService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    // Initialize services
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    // Execute commands here
  }

  // Handle view activation/deactivation
  viewActivated(viewPath: string) {
    /* ... */
  }
  viewDeactivated() {
    /* ... */
  }

  // Search handling
  async search(query: string): Promise<ExtensionResult[]> {
    /* ... */
  }
  async onViewSearch?(query: string): Promise<void> {
    /* ... */
  }

  // Lifecycle methods
  async activate(): Promise<void> {
    /* ... */
  }
  async deactivate(): Promise<void> {
    /* ... */
  }
}

export default new MyExtension();
```

### Result Extension

Returns immediate results in the search list.

```typescript
// Example result extension search method
async search(query: string): Promise<ExtensionResult[]> {
  this.logService?.debug(`Checking query: ${query}`);

  if (isMathExpression(query)) {
    try {
      const result = evaluate(query);
      return [
        {
          title: `${query} = ${result}`,
          subtitle: "Press Enter to copy to clipboard",
          type: "result",
          action: async () => {
            await navigator.clipboard.writeText(result.toString());
            this.logService?.info(`Copied result: ${result}`);
            this.extensionManager?.closeView();
          },
          score: 1,
        },
      ];
    } catch (error) {
      this.logService?.debug(`Error: ${error}`);
    }
  }
  return [];
}
```

### View Extension

Opens a new view when selected.

```typescript
// Example view extension search method
async search(query: string): Promise<ExtensionResult[]> {
  if (query.toLowerCase().includes("clipboard")) {
    return [
      {
        title: "Clipboard History",
        subtitle: "View and manage your clipboard history",
        type: "view",
        action: () => this.extensionManager?.navigateToView("clipboard-history/ClipboardHistory"),
        score: 1,
      },
    ];
  }
  return [];
}
```

For view extensions, create a Svelte component with this structure:

```svelte
<!-- YourView.svelte -->
<script lang="ts">
  import { Button } from "../../components";
  // Import any other components you need
</script>

<div class="h-[calc(100vh-72px)] overflow-y-auto">
  <div class="p-8">
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
async onViewSearch(query: string): Promise<void> {
  // Update your view based on the search query
  viewState.setSearch(query);
}
```

### Extension State Management

For searchable views, create a state.ts file to handle state management:

```typescript
// state.ts
import { writable, get } from "svelte/store";
import type { ExtensionContext, ILogService } from "asyar-api";

function createViewState() {
  const { subscribe, set, update } = writable({
    searchQuery: "",
    filtered: false,
    items: [],
    isLoading: true,
  });

  // Reference to services
  let logService: ILogService;

  // Initialize services
  function initializeServices(context: ExtensionContext) {
    logService = context.getService("LogService");
  }

  return {
    subscribe,
    initializeServices,
    setSearch: (query: string) =>
      update((state) => ({
        ...state,
        searchQuery: query,
        filtered: query.length > 0,
      })),
    setItems: (items: any[]) =>
      update((state) => ({
        ...state,
        items,
        isLoading: false,
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
    ? $viewState.items.filter(item =>
        item.content.toLowerCase().includes($viewState.searchQuery.toLowerCase())
      )
    : $viewState.items;
</script>
```

## Example Extensions

### Clipboard History Extension

A view extension that shows clipboard history:

```typescript
// index.ts
import type {
  Extension,
  ExtensionContext,
  ExtensionResult,
  ILogService,
  IExtensionManager,
  IClipboardHistoryService,
} from "asyar-api";
import type { ExtensionAction, IActionService } from "asyar-api/dist/types";
import { clipboardViewState } from "./state";

class ClipboardHistoryExtension implements Extension {
  onUnload: any;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private clipboardService?: IClipboardHistoryService;
  private actionService?: IActionService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    this.context = context;
    this.logService = context.getService<ILogService>("LogService");
    this.extensionManager =
      context.getService<IExtensionManager>("ExtensionManager");
    this.clipboardService = context.getService<IClipboardHistoryService>(
      "ClipboardHistoryService"
    );
    this.actionService = context.getService<IActionService>("ActionService");

    // Initialize state services
    clipboardViewState.initializeServices(context);

    this.logService?.info("Clipboard History extension initialized");
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(`Executing clipboard command: ${commandId}`);

    switch (commandId) {
      case "show-clipboard":
        this.extensionManager?.navigateToView(
          "clipboard-history/ClipboardHistory"
        );
        return {
          type: "view",
          viewPath: "clipboard-history/ClipboardHistory",
        };

      default:
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  viewActivated(viewPath: string) {
    this.inView = true;

    // Register view-specific actions
    if (this.actionService && this.clipboardService) {
      const resetHistoryAction: ExtensionAction = {
        id: "clipboard-reset-history",
        title: "Clear Clipboard History",
        description: "Remove all non-favorite clipboard items",
        icon: "🗑️",
        extensionId: "clipboard-history",
        category: "clipboard-action",
        execute: async () => {
          try {
            await this.clipboardService?.clearHistory();
            this.logService?.info("Clipboard history cleared");
          } catch (error) {
            this.logService?.error(`Failed to clear history: ${error}`);
          }
        },
      };

      this.actionService.registerAction(resetHistoryAction);
    }
  }

  viewDeactivated() {
    if (this.inView && this.actionService) {
      this.actionService.unregisterAction("clipboard-reset-history");
    }
    this.inView = false;
  }

  async search(query: string): Promise<ExtensionResult[]> {
    if (query.toLowerCase().startsWith("clip")) {
      return [
        {
          title: "Clipboard History",
          subtitle: "View and manage your clipboard history",
          type: "view",
          action: () =>
            this.extensionManager?.navigateToView(
              "clipboard-history/ClipboardHistory"
            ),
          score: 1,
        },
      ];
    }
    return [];
  }

  async onViewSearch(query: string) {
    clipboardViewState.setSearch(query);
  }

  async activate(): Promise<void> {
    this.logService?.info("Clipboard History extension activated");
  }

  async deactivate(): Promise<void> {
    this.logService?.info("Clipboard History extension deactivated");
  }
}

export default new ClipboardHistoryExtension();
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
      "id": "show-clipboard",
      "name": "clipboard-history",
      "description": "Show clipboard history",
      "trigger": "clip"
    }
  ]
}
```

## Direct Search Results

Your extension can directly display search results in the main search interface by properly handling the query in your `search()` method.

### How Direct Search Works

When a user types a specific prefix or pattern that matches your extension's commands, your extension can return results that appear directly in the main search list.

### Implementing Direct Search

To implement direct search functionality:

1. Detect your command patterns in the `search()` method
2. Return well-scored result items for matching queries
3. Use descriptive titles and subtitles to make it clear what the results represent

```typescript
async search(query: string): Promise<ExtensionResult[]> {
  // Direct search for "tauri something" queries
  if (query.toLowerCase().startsWith("tauri ")) {
    const searchTerm = query.substring("tauri ".length).trim();
    const results = await searchDocs(searchTerm);

    return results.slice(0, 5).map((doc, index) => ({
      title: doc.title,
      subtitle: doc.description,
      type: "result",
      action: async () => {
        await openUrl(doc.url);
        this.extensionManager?.closeView();
      },
      // Higher scores appear first in results
      score: 1 - index,
    }));
  }

  // For just "tauri", show the option to open the full view
  if (query.toLowerCase() === "tauri") {
    return [{
      title: "Tauri Documentation",
      subtitle: "Browse the official Tauri documentation",
      type: "view",
      action: () => this.extensionManager?.navigateToView("tauri-docs/TauriDocsView"),
      score: 1,
    }];
  }

  return [];
}
```

The `score` property determines the position of your results in the search list. Higher scores will appear closer to the top.
