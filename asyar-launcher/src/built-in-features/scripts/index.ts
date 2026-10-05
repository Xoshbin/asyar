import { t } from '../../services/i18n';
import { ActionContext, type Extension, type ExtensionContext } from 'asyar-sdk/contracts';
import { scriptsManager } from './scriptsManager.svelte';
import { dispatchScriptCommand } from './dispatch';
import { runSelectedScript } from './runSelected';
import ScriptLibraryView from './ScriptLibraryView.svelte';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';
import { actionService, type ApplicationAction } from '../../services/action/actionService.svelte';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { writeText } from 'tauri-plugin-clipboard-x-api';

export { ScriptLibraryView };

registerBuiltinDynamicDispatcher('scripts', dispatchScriptCommand);

const LIBRARY_VIEW = 'scripts/ScriptLibraryView';
const LIBRARY_ACTION_IDS = [
  'scripts:run',
  'scripts:reveal',
  'scripts:copy-path',
  'scripts:rescan',
  'scripts:add-directory',
  'scripts:make-executable',
] as const;

class ScriptsExtension implements Extension {
  async initialize(_context: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    await scriptsManager.start();
  }

  async deactivate(): Promise<void> {
    this.unregisterLibraryActions();
    await scriptsManager.stop();
  }

  async viewActivated(viewId: string): Promise<void> {
    if (viewId === LIBRARY_VIEW) this.registerLibraryActions();
  }

  async viewDeactivated(viewId: string): Promise<void> {
    if (viewId === LIBRARY_VIEW) this.unregisterLibraryActions();
  }

  async onViewSubmit(_query: string): Promise<void> {
    await runSelectedScript();
  }

  async executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    if (commandId === 'script-library') {
      return { type: 'view', viewPath: LIBRARY_VIEW };
    }
    await dispatchScriptCommand(commandId, args);
    return { type: 'no-view' };
  }

  private registerLibraryActions(): void {
    const actions: ApplicationAction[] = [
      {
        id: 'scripts:run',
        label: t('features.scripts.act.run'),
        description: t('features.scripts.act.run_desc'),
        icon: 'icon:activity',
        extensionId: 'scripts',
        category: t('categories.scripts'),
        context: ActionContext.EXTENSION_VIEW,
        visible: () => scriptsManager.selectedScript !== undefined,
        execute: async () => runSelectedScript(),
      },
      {
        id: 'scripts:reveal',
        label: t('features.scripts.act.reveal'),
        description: t('features.scripts.act.reveal_desc'),
        icon: 'icon:folder',
        extensionId: 'scripts',
        category: t('categories.scripts'),
        context: ActionContext.EXTENSION_VIEW,
        visible: () => scriptsManager.selectedPath !== undefined,
        execute: async () => {
          const path = scriptsManager.selectedPath;
          if (path) await revealItemInDir(path);
        },
      },
      {
        id: 'scripts:copy-path',
        label: t('features.scripts.act.copy_path'),
        description: t('features.scripts.act.copy_path_desc'),
        icon: 'icon:clipboard',
        extensionId: 'scripts',
        category: t('categories.scripts'),
        context: ActionContext.EXTENSION_VIEW,
        visible: () => scriptsManager.selectedPath !== undefined,
        execute: async () => {
          const path = scriptsManager.selectedPath;
          if (path) await writeText(path);
        },
      },
      {
        id: 'scripts:rescan',
        label: t('features.scripts.act.rescan'),
        description: t('features.scripts.act.rescan_desc'),
        icon: 'icon:refresh',
        extensionId: 'scripts',
        category: t('categories.scripts'),
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => scriptsManager.rescan(),
      },
      {
        id: 'scripts:add-directory',
        label: t('features.scripts.act.add_dir'),
        description: t('features.scripts.act.add_dir_desc'),
        icon: 'icon:plus',
        extensionId: 'scripts',
        category: t('categories.scripts'),
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => scriptsManager.addDirectory(),
      },
      {
        id: 'scripts:make-executable',
        label: t('features.scripts.act.make_exec'),
        description: t('features.scripts.act.make_exec_desc'),
        icon: 'icon:power',
        extensionId: 'scripts',
        category: t('categories.scripts'),
        context: ActionContext.EXTENSION_VIEW,
        visible: () => scriptsManager.selectedIssue?.fix === 'makeExecutable',
        execute: async () => scriptsManager.makeSelectedExecutable(),
      },
    ];

    for (const action of actions) actionService.registerAction(action);
  }

  private unregisterLibraryActions(): void {
    for (const id of LIBRARY_ACTION_IDS) actionService.unregisterAction(id);
  }
}

const extension = new ScriptsExtension();
export default extension;
