import * as runtimeCommands from '../../lib/ipc/runtimeCommands';
import type {
  RuntimeDownloadProgress,
  EnsureRuntimeResult,
  InstalledRuntimeInfo,
} from '../../lib/ipc/runtimeCommands';
import { type UnlistenFn } from '@tauri-apps/api/event';
import { appListen } from '../../lib/ipc/bridgeEvents';

class RuntimeService {
  downloadProgress = $state<RuntimeDownloadProgress | null>(null);

  private unlistenProgress: UnlistenFn | null = null;

  async init(): Promise<void> {
    this.unlistenProgress = await appListen<RuntimeDownloadProgress>(
      'runtime_download_progress',
      (event) => {
        this.downloadProgress = event.payload;
      },
    );
  }

  async resolve(name: string): Promise<string | null> {
    return runtimeCommands.resolveRuntime(name);
  }

  async ensure(name: string): Promise<EnsureRuntimeResult> {
    return runtimeCommands.ensureRuntime(name);
  }

  async download(name: string): Promise<boolean> {
    return runtimeCommands.downloadRuntime(name);
  }

  async list(): Promise<InstalledRuntimeInfo[]> {
    return runtimeCommands.listRuntimes();
  }

  async remove(name: string): Promise<void> {
    await runtimeCommands.removeRuntime(name);
  }

  async consumersOf(name: string): Promise<string[]> {
    return runtimeCommands.getRuntimeConsumers(name);
  }

  destroy(): void {
    this.unlistenProgress?.();
  }
}

export const runtimeService = new RuntimeService();
