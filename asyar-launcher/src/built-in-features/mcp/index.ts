import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { mcpService } from './mcpService.svelte';
import ManageServersView from './ManageServersView.svelte';
import ImportServersView from './ImportServersView.svelte';
import InstallServerView from './InstallServerView.svelte';

export { ManageServersView, ImportServersView, InstallServerView };

class McpExtension implements Extension {
  async initialize(_context: ExtensionContext): Promise<void> {
    // no-op — MCP service is a module singleton, no bootstrap needed
  }

  async activate(): Promise<void> {
    // no-op
  }

  async deactivate(): Promise<void> {
    // no-op
  }

  async viewActivated(viewId: string): Promise<void> {
    if (viewId === 'mcp/ManageServersView') {
      await mcpService.refresh();
    }
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    // no-op
  }

  async executeCommand(commandId: string): Promise<unknown> {
    switch (commandId) {
      case 'manage':
        return { type: 'view', viewPath: 'mcp/ManageServersView' };
      case 'import':
        return { type: 'view', viewPath: 'mcp/ImportServersView' };
      case 'install':
        return { type: 'view', viewPath: 'mcp/InstallServerView' };
      default:
        throw new Error(`unknown mcp command: ${commandId}`);
    }
  }
}

const extension = new McpExtension();
export default extension;
