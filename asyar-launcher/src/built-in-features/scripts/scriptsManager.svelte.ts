import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  scriptsRescan,
  replaceDynamicCommandsBuiltin,
} from '../../lib/ipc/commands';
import { logService } from '../../services/log/logService';
import type { ScannedScript } from './types';
import type { DynamicCommandRegistration } from 'asyar-sdk/contracts';

const SCRIPTS_EXTENSION_ID = 'scripts';

export class ScriptsManager {
  scripts = $state<ScannedScript[]>([]);
  private unlistenFn: UnlistenFn | null = null;

  async start(): Promise<void> {
    if (this.unlistenFn) return;

    this.unlistenFn = await listen('scripts:changed', () => {
      void this.refresh().catch((err) => {
        logService.warn(`[scripts] refresh on event failed: ${err}`);
      });
    });
    try {
      await this.refresh();
    } catch (err) {
      logService.warn(`[scripts] initial refresh failed: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.unlistenFn) {
      this.unlistenFn();
      this.unlistenFn = null;
    }
    await replaceDynamicCommandsBuiltin(SCRIPTS_EXTENSION_ID, []);
    this.scripts = [];
  }

  getScriptByDynamicId(id: string): ScannedScript | undefined {
    return this.scripts.find((s) => s.dynamicId === id);
  }

  reset(): void {
    this.scripts = [];
    this.unlistenFn = null;
  }

  private async refresh(): Promise<void> {
    const fresh = await scriptsRescan();
    const regs: DynamicCommandRegistration[] = fresh.map((s) => ({
      id: s.dynamicId,
      name: s.header.title ?? deriveFilenameTitle(s.absolutePath),
      icon: s.header.icon ?? undefined,
      arguments: s.header.arguments,
    }));
    await replaceDynamicCommandsBuiltin(SCRIPTS_EXTENSION_ID, regs);
    this.scripts = fresh;
  }
}

function deriveFilenameTitle(absolutePath: string): string {
  const base = absolutePath.split(/[\\/]/).pop() ?? absolutePath;
  return base.replace(/\.[^.]+$/, '') || base;
}

export const scriptsManager = new ScriptsManager();
