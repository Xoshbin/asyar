### Type 1: View Extension (`view`)

**Use when:** Your extension primarily opens a rich UI panel. A task manager, a media browser, a form, a settings editor.

**How it works:**
1. User types the command name → selects it → presses Enter.
2. Asyar opens an iframe and loads your `index.html?view=DefaultView`.
3. Your Svelte component renders.
4. The user interacts with the UI.

**Manifest template:**
```json
{
  "type": "view",
  "searchable": false,
  "defaultView": "DefaultView",
  "commands": [
    { "id": "open", "name": "Open My Tool", "resultType": "view", "view": "DefaultView" }
  ]
}
```

**`src/index.ts` pattern:**
```typescript
import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk';
import DefaultView from './DefaultView.svelte';

class MyExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('ExtensionManager');
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async viewActivated(viewId: string): Promise<void> {}
  async viewDeactivated(viewId: string): Promise<void> {}

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'open') {
      this.extensionManager?.navigateToView('com.yourname.mytool/DefaultView');
      return { type: 'view', viewPath: 'com.yourname.mytool/DefaultView' };
    }
  }

  onUnload = () => {};
}

export default new MyExtension();
export { DefaultView };
```
