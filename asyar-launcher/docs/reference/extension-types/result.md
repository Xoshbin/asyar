---
order: 2
---
### Type 2: Result Extension (`result`)

**Use when:** Your extension is fundamentally a search engine over some data — documentation, bookmarks, contacts, files. Users type, see instant results, click a result to open a detail view.

**How it works:**
1. Asyar maintains a **hidden background iframe** for your extension at all times (because `searchable: true` is required).
2. As the user types in the global search bar, Asyar sends an `asyar:search:request` message to your background iframe.
3. Your `search(query)` method returns `ExtensionResult[]`.
4. Results appear directly in the global launcher search results.
5. When the user selects a result, `action()` fires. For Tier 2 (installed) extensions, the `action` closure cannot cross the iframe boundary — Asyar automatically navigates to the `viewPath` in the result instead.

> ⚠️ **The `action` function on `ExtensionResult` is ignored for installed extensions (Tier 2)** because functions cannot be serialized over `postMessage`. Always set `viewPath` on results to control navigation.

**Manifest template:**
```json
{
  "type": "result",
  "searchable": true,
  "main": "dist/index.js",
  "defaultView": "DetailView",
  "commands": [
    { "id": "search", "name": "Search My Data", "resultType": "view", "view": "DetailView" }
  ]
}
```

**`src/index.ts` pattern:**
```typescript
import type {
  Extension, ExtensionContext, ExtensionResult,
  IExtensionManager, ILogService
} from 'asyar-sdk';
import DetailView from './DetailView.svelte';

const ITEMS = [
  { id: '1', title: 'Introduction', subtitle: 'Getting started guide' },
  { id: '2', title: 'API Reference', subtitle: 'Full API documentation' },
];

class MyExtension implements Extension {
  private extensionManager?: IExtensionManager;
  private logger?: ILogService;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
    this.logger = context.getService<ILogService>('log');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async search(query: string): Promise<ExtensionResult[]> {
    const q = query.toLowerCase();
    return ITEMS
      .filter(item => !q || item.title.toLowerCase().includes(q))
      .map(item => ({
        score: 1,
        title: item.title,
        subtitle: item.subtitle,
        type: 'view' as const,
        // viewPath is used by Tier 2 extensions to navigate on selection.
        // Pass context via URL params.
        viewPath: `com.yourname.mydocs/DetailView?id=${item.id}`,
        action: () => {
          this.extensionManager?.navigateToView(
            `com.yourname.mydocs/DetailView?id=${item.id}`
          );
        },
      }));
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'search') {
      return { type: 'view', viewPath: 'com.yourname.mydocs/DetailView' };
    }
  }

  onUnload = () => {};
}

export default new MyExtension();
export { DetailView };
```

**Reading URL params in the detail view:**
```svelte
<!-- src/DetailView.svelte -->
<script lang="ts">
  const params = new URLSearchParams(window.location.search);
  let itemId = $state(params.get('id') ?? '');
  let title  = $state(params.get('title') ?? 'Detail');
</script>
```
