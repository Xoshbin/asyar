---
order: 3
---
### Method B: Manual scaffold

If you prefer full control, here is the minimum project structure:

```
com.yourname.hello-world/
├── manifest.json
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.ts
    ├── index.ts
    └── DefaultView.svelte
```

> ⚠️ **`index.html` must be in the project root, not inside `src/`. The validator and Vite both require it there.**

#### `manifest.json`

```json
{
  "id": "com.yourname.hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal Asyar extension that says hello.",
  "author": "Your Name",
  "icon": "👋",
  "main": "dist/index.js",
  "searchable": false,
  "type": "view",
  "defaultView": "DefaultView",
  "asyarSdk": "^1.3.3",
  "commands": [
    {
      "id": "open",
      "name": "Open Hello World",
      "description": "Opens the Hello World view",
      "resultType": "view",
      "view": "DefaultView"
    }
  ]
}
```

#### `src/main.ts`

```typescript
import { mount } from 'svelte';
import DefaultView from './DefaultView.svelte';
import { ExtensionContext, type ILogService } from 'asyar-sdk';

// The hostname of the asyar-extension:// URL is always your extension ID.
const extensionId = window.location.hostname || 'com.yourname.hello-world';

// 1. Create ONE context for the entire iframe lifetime.
//    Do NOT create a second one inside a component.
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// 2. Signal readiness to the host. Without this, the host will not
//    route actions or service calls to this iframe.
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// 3. Forward ⌘K to the host so the Action Drawer opens from inside the iframe.
window.addEventListener('keydown', (event) => {
  const isCommandK = (event.metaKey || event.ctrlKey) && event.key === 'k';
  if (isCommandK) {
    event.preventDefault();
    window.parent.postMessage({
      type: 'asyar:extension:keydown',
      payload: {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      }
    }, '*');
  }
});

// 4. Resolve the view from the URL query param.
const viewName = new URLSearchParams(window.location.search).get('view') || 'DefaultView';

// 5. Mount the Svelte component, passing services as props.
if (viewName === 'DefaultView') {
  mount(DefaultView, {
    target: document.getElementById('app')!,
    props: {
      logger: context.getService<ILogService>('log'),
    }
  });
}
```

#### `src/DefaultView.svelte`

```svelte
<script lang="ts">
  import type { ILogService } from 'asyar-sdk';

  interface Props {
    logger: ILogService;
  }
  let { logger }: Props = $props();

  let count = $state(0);

  function handleClick() {
    count++;
    logger.info(`Hello World: button clicked ${count} times`);
  }
</script>

<div class="container">
  <h1>Hello from Asyar!</h1>
  <p>Your first extension is running inside a sandboxed iframe.</p>
  <button onclick={handleClick}>
    Clicked {count} times
  </button>
</div>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-family: system-ui, sans-serif;
    padding: 2rem;
    background: var(--bg-primary);
    color: var(--text-primary);
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  p  { opacity: 0.7; margin-bottom: 1.5rem; }
  button {
    background: var(--accent-primary, #2563eb);
    color: white;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
</style>
```

#### `src/index.ts`

```typescript
import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import DefaultView from './DefaultView.svelte';

class HelloWorldExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open') {
      this.extensionManager?.navigateToView('com.yourname.hello-world/DefaultView');
      return { type: 'view', viewPath: 'com.yourname.hello-world/DefaultView' };
    }
  }

  onUnload = () => {};
}

export default new HelloWorldExtension();
export { DefaultView };
```

#### `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hello World</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

#### `vite.config.ts`

```typescript
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath, URL } from 'url';
import { existsSync } from 'fs';
import { resolve } from 'path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const localSdkEntry = resolve(__dirname, '../../asyar-sdk/src/index.ts');

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  resolve: {
    // In development, resolve the SDK from source for a faster feedback loop.
    // In production, this alias is absent and the installed npm package is used.
    alias:
      mode === 'development' && existsSync(localSdkEntry)
        ? { 'asyar-sdk': localSdkEntry }
        : undefined,
  },
}));
```

#### `package.json`

```json
{
  "name": "com.yourname.hello-world",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev":      "vite build --watch",
    "build":    "asyar build",
    "validate": "asyar validate",
    "link":     "asyar link",
    "publish":  "asyar publish"
  },
  "dependencies": {
    "asyar-sdk": "^1.3.3",
    "svelte": "^5.0.0"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^5.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  }
}
```

#### Register and run

```bash
# Register the project path with Asyar (only needed for manually created extensions)
asyar link

# Start the file watcher — rebuild on every save
pnpm dev
```

Open Asyar, type `Open Hello World`, press Enter. The panel renders.
