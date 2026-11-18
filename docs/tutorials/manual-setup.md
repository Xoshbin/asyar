---
order: 3
---

### Method B: Manual scaffold

If you prefer full control, here is the minimum project structure (clean source files only — no root HTML files required):

```
com.yourname.hello-world/
├── manifest.json
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── view.ts
    └── DefaultView.svelte
```

#### `manifest.json`

```json
{
  "id": "com.yourname.hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "A minimal Asyar extension that says hello.",
  "author": "Your Name",
  "icon": "👋",
  "type": "extension",
  "asyarSdk": "^4.20.0",
  "commands": [
    {
      "id": "open",
      "name": "Open Hello World",
      "description": "Opens the Hello World view",
      "mode": "view",
      "component": "DefaultView"
    }
  ]
}
```

#### `src/view.ts`

```typescript
import 'asyar-sdk/tokens.css';
import { mount } from 'svelte';
import { ExtensionContext, registerIconElement, type ILogService } from 'asyar-sdk/view';
import DefaultView from './DefaultView.svelte';

registerIconElement();

const extensionId = window.location.hostname || 'com.yourname.hello-world';
const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Signal readiness to the host
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');

// Mount the Svelte component into document body
mount(DefaultView, {
  target: document.body,
  props: {
    logger: context.getService<ILogService>('log'),
  },
});
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
  h1 {
    font-size: 1.5rem;
    margin-bottom: 0.5rem;
  }
  p {
    opacity: 0.7;
    margin-bottom: 1.5rem;
  }
  button {
    background: var(--accent-primary, #2563eb);
    color: white;
    border: none;
    padding: 0.5rem 1.25rem;
    border-radius: 6px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover {
    opacity: 0.85;
  }
</style>
```

#### `vite.config.ts`

```typescript
import { defineExtensionConfig } from 'asyar-sdk/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineExtensionConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  config: {
    plugins: [svelte()],
  },
});
```

#### `package.json`

```json
{
  "name": "com.yourname.hello-world",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite build --watch",
    "build": "asyar build",
    "validate": "asyar validate",
    "link": "asyar link",
    "publish": "asyar publish"
  },
  "dependencies": {
    "asyar-sdk": "^3.1.0",
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
