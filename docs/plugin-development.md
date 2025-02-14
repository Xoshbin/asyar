# Plugin Development Guide

## Overview

This guide explains how to create plugins for Asyar. Plugins can extend the application's functionality by adding new commands, views, and search results.

> **Note**: This documentation might be outdated or not completely mirror the current plugin system due to frequent changes in the early development stages of the application. Please refer to the latest source code.

## Plugin Structure

A plugin consists of these parts:

1. Plugin manifest (JSON)
2. Plugin implementation (TypeScript/JavaScript)
3. Plugin views (React components) - Optional
4. Package dependencies (package.json) - Optional

### Directory Structure

```
/src/plugins/my-plugin/
├── manifest.json
├── package.json
├── plugin.ts
├── services/
│   └── myService.ts
└── components/
    └── MyView.tsx
```

### Plugin API

Plugins receive access to core functionality through the injected `api` property:

```typescript
interface PluginAPI {
  ui: {
    showView(pluginId: string, viewName: string): Promise<void>;
    hidePanel(): Promise<void>;
    createViewTransition(
      pluginId: string,
      viewName: string
    ): ViewTransitionAction;
  };
  system: {
    log: {
      info(message: string): void;
      error(message: string): void;
    };
    openApp(appPath: string): Promise<void>;
    searchApps(query: string): Promise<AppResult[]>;
    getAppIcon(appName: string): Promise<string>;
  };
  clipboard: {
    read(): Promise<string>;
    write(text: string): Promise<void>;
    copy(text: string): Promise<boolean>;
  };
  store: {
    get<T>(storeName: string, key: string): Promise<T | null>;
    set<T>(storeName: string, key: string, value: T): Promise<boolean>;
    save(storeName: string): Promise<boolean>;
    clear(storeName: string): Promise<boolean>;
  };
  commands: {
    register(pluginId: string, command: SearchResultItem): void;
    unregister(pluginId: string): void;
    search(query: string): SearchResultItem[];
  };
}
```

### Plugin Implementation

```typescript
import { Plugin } from "../../types/Plugin";
import { log, ui, clipboard } from "@asyar/api";

const plugin: Plugin = {
  manifest: null!, // Will be injected by plugin loader

  async initialize() {
    log.info("Plugin initializing...");
    await this.registerCommands();
  },

  async getView(viewName: string) {
    if (viewName === "myView") {
      return MyView;
    }
    throw new Error(`View not found: ${viewName}`);
  },

  getSearchResults(query: string) {
    return [
      {
        id: "example",
        title: "Example Result",
        subtitle: "Click to copy",
        category: "command",
        icon: "plugin",
        score: 1,
        action: async () => {
          await clipboard.write("Example");
          log.info("Copied example text");
          return { type: "NONE" };
        },
      },
    ];
  },
};

export default plugin;
```

## Example Plugins

### 1. Calculator Plugin

Simple plugin that provides calculation results in search:

```typescript
import { Plugin } from "../../types/Plugin";
import { CalculatorService } from "./services/calculator";
import { log, clipboard } from "@asyar/api";

const plugin: Plugin = {
  manifest: null!,

  async initialize() {
    log.info("Calculator plugin initialized");
  },

  getSearchResults(query: string) {
    if (!CalculatorService.isCalculation(query)) return [];

    const result = CalculatorService.calculate(query);
    if (!result) return [];

    return [
      {
        id: "calc_result",
        title: result,
        subtitle: "Click to copy",
        category: "calculation",
        icon: "calculator",
        score: 1,
        action: async () => {
          await clipboard.write(result);
          log.info(`Copied result: ${result}`);
          return { type: "NONE" };
        },
      },
    ];
  },
};

export default plugin;
```

### 2. Greeting Plugin

Plugin with UI view and command registration:

```typescript
import { Plugin } from "../../types/Plugin";
import { log, commands, ui } from "@asyar/api";

const plugin: Plugin = {
  manifest: null!,

  async initialize() {
    log.info("Greeting plugin initializing...");
    await this.registerCommands();
  },

  async getView(viewName: string) {
    if (viewName === "greeting") {
      return GreetingView;
    }
    throw new Error(`View not found: ${viewName}`);
  },

  async registerCommands() {
    commands.register(this.manifest.id, {
      id: "greet",
      title: "Show Greeting",
      subtitle: "Open greeting view",
      category: "command",
      icon: "plugin",
      score: 1,
      action: async () => {
        return ui.createViewTransition(this.manifest.id, "greeting");
      },
    });
  },
};

export default plugin;
```

## Best Practices

1. Use the provided API for all core functionality
2. Handle errors gracefully
3. Use proper TypeScript types
4. Log important events using `api.system.log`
5. Keep plugin dependencies minimal
6. Follow the plugin lifecycle
7. Use meaningful command names and descriptions

## API Usage Examples

### Storage

```typescript
import { store } from "@asyar/api";

// Save data
await store.set("my-plugin", "key", value);
await store.save("my-plugin");

// Read data
const data = await store.get("my-plugin", "key");
```

### Clipboard

```typescript
import { clipboard } from "@asyar/api";

// Copy text
await clipboard.write("Hello World");

// Read clipboard
const text = await clipboard.read();
```

### System

```typescript
import { log, system } from "@asyar/api";

// Logging
log.info("Message");
log.error("Error occurred");

// Apps
await system.openApp("/Applications/Calculator.app");
```

### UI

```typescript
import { ui } from "@asyar/api";

// Show view
return ui.createViewTransition(pluginId, "viewName");

// Hide panel
await ui.hidePanel();
```

The core app will automatically:

- Load your plugin
- Inject the API
- Initialize the plugin
- Register commands and views
