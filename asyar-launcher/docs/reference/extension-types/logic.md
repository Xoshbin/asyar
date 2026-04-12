---
order: 3
---
### Type 3: Logic Extension (`logic`)

**Use when:** Your extension performs actions but never opens a UI panel — a "copy today's date", a "toggle system theme", a "trigger a webhook" command. The logic runs in the background iframe and communicates results via notifications.

**How it works:**
1. A background iframe loads `index.html` with no view component mounted.
2. The extension listens for `asyar:invoke:command` or `asyar:search:request` messages.
3. It performs work and optionally shows a notification.
4. No view panel ever opens.

**Manifest template:**
```json
{
  "type": "result",
  "searchable": true,
  "main": "dist/index.js",
  "commands": [
    { "id": "run", "name": "Run My Action", "resultType": "no-view" }
  ]
}
```

**`src/main.ts` pattern (no view mounting):**
```typescript
import { ExtensionContext } from 'asyar-sdk';

const extensionId = window.location.hostname || 'com.yourname.myaction';

const context = new ExtensionContext();
context.setExtensionId(extensionId);

// Signal readiness — still required even with no UI.
window.parent.postMessage({ type: 'asyar:extension:loaded', extensionId }, '*');
```

**`src/index.ts` pattern:**
```typescript
import type {
  Extension, ExtensionContext, ExtensionResult,
  ILogService, INotificationService
} from 'asyar-sdk';

class MyLogicExtension implements Extension {
  private logger?: ILogService;
  private notifications?: INotificationService;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logger = context.getService<ILogService>('LogService');
    this.notifications = context.getService<INotificationService>('NotificationService');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async search(query: string): Promise<ExtensionResult[]> {
    return [
      {
        score: 1,
        title: 'Run My Action',
        subtitle: 'Executes the background action',
        type: 'result' as const,
        action: async () => {
          await this.runAction();
        },
      }
    ];
  }

  private async runAction(): Promise<void> {
    this.logger?.info('Running background action');
    // ... do work ...
    await this.notifications?.notify({ title: 'Done', body: 'Action completed.' });
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'run') {
      await this.runAction();
    }
  }

  onUnload = () => {};
}

export default new MyLogicExtension();
```
