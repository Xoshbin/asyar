import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import { mcpService } from './mcpService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
import ManageServersView from './ManageServersView.svelte';
import ImportServersView from './ImportServersView.svelte';
import InstallServerView from './InstallServerView.svelte';
import PermissionsView from './PermissionsView.svelte';
import ActivityView from './ActivityView.svelte';

export {
  ManageServersView,
  ImportServersView,
  InstallServerView,
  PermissionsView,
  ActivityView,
};

const ACTION_REFRESH = 'mcp:refresh-servers';
const ACTION_INSTALL = 'mcp:install-server';
const ACTION_IMPORT = 'mcp:import-servers';
const ACTION_VIEW_PERMISSIONS = 'mcp:view-permissions';
const ACTION_VIEW_ACTIVITY = 'mcp:view-activity';
const ACTION_TOGGLE_STRICT = 'mcp:toggle-strict-mode';

const ALL_ACTIONS = [
  ACTION_REFRESH,
  ACTION_INSTALL,
  ACTION_IMPORT,
  ACTION_VIEW_PERMISSIONS,
  ACTION_VIEW_ACTIVITY,
  ACTION_TOGGLE_STRICT,
];

class McpExtension implements Extension {
  async initialize(_context: ExtensionContext): Promise<void> {
    // no-op — actions are registered per-view in viewActivated below so
    // they only appear in ⌘K while the user is inside an MCP view.
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
    } else if (viewId === 'mcp/PermissionsView') {
      await mcpService.refreshPermissions();
    }

    // View-scoped action commands — appear in ⌘K only while an MCP view
    // is the active view. Matches the snippets/agents extension pattern.
    if (viewId.startsWith('mcp/')) {
      actionService.registerAction({
        id: ACTION_REFRESH,
        label: 'Refresh Servers',
        icon: '🔄',
        description: 'Re-query MCP server statuses and tool lists',
        category: 'MCP',
        extensionId: 'mcp',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await mcpService.refresh();
        },
      });
      actionService.registerAction({
        id: ACTION_INSTALL,
        label: 'Install MCP Server',
        icon: '➕',
        description: 'Add a new MCP server manually',
        category: 'MCP',
        extensionId: 'mcp',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          viewManager.navigateToView('mcp/InstallServerView');
        },
      });
      actionService.registerAction({
        id: ACTION_IMPORT,
        label: 'Import MCP Servers',
        icon: '📥',
        description: 'Import servers from existing configs or pasted JSON',
        category: 'MCP',
        extensionId: 'mcp',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          viewManager.navigateToView('mcp/ImportServersView');
        },
      });
      actionService.registerAction({
        id: ACTION_VIEW_PERMISSIONS,
        label: 'View MCP Permissions',
        icon: '🔑',
        description: 'Open the saved permission decisions for MCP tool calls',
        category: 'MCP',
        extensionId: 'mcp',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          viewManager.navigateToView('mcp/PermissionsView');
        },
      });
      actionService.registerAction({
        id: ACTION_VIEW_ACTIVITY,
        label: 'View Recent MCP Activity',
        icon: '📜',
        description: 'See the audit log of MCP tool calls — success and failure',
        category: 'MCP',
        extensionId: 'mcp',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          viewManager.navigateToView('mcp/ActivityView');
        },
      });
      actionService.registerAction({
        id: ACTION_TOGGLE_STRICT,
        label: 'Toggle Strict Mode',
        icon: '🛡️',
        description:
          'Always ask before any MCP tool call (recommended for untrusted servers)',
        category: 'MCP',
        extensionId: 'mcp',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await mcpService.setStrictMode(!mcpService.strictMode);
        },
      });
    }
  }

  async viewDeactivated(viewId: string): Promise<void> {
    if (viewId.startsWith('mcp/')) {
      for (const id of ALL_ACTIONS) {
        actionService.unregisterAction(id);
      }
    }
  }

  async executeCommand(commandId: string): Promise<unknown> {
    switch (commandId) {
      case 'manage':
        return { type: 'view', viewPath: 'mcp/ManageServersView' };
      case 'import':
        return { type: 'view', viewPath: 'mcp/ImportServersView' };
      case 'install':
        return { type: 'view', viewPath: 'mcp/InstallServerView' };
      case 'permissions':
        return { type: 'view', viewPath: 'mcp/PermissionsView' };
      default:
        throw new Error(`unknown mcp command: ${commandId}`);
    }
  }
}

const extension = new McpExtension();
export default extension;
