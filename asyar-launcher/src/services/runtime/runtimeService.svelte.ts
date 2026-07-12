import * as runtimeCommands from '../../lib/ipc/runtimeCommands';
import type {
  RuntimeDownloadProgress,
  EnsureRuntimeResult,
  InstalledRuntimeInfo,
} from '../../lib/ipc/runtimeCommands';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

class RuntimeService {
  downloadProgress = $state<RuntimeDownloadProgress | null>(null);

  private unlistenProgress: UnlistenFn | null = null;

  async init(): Promise<void> {
    this.unlistenProgress = await listen<RuntimeDownloadProgress>(
      'runtime_download_progress',
      (event) => {
        this.downloadProgress = event.payload;
      },
    );
  }

  async resolve(name: string): Promise<string | null> {
    return runtimeCommands.resolveRuntime(name);
  }

  async ensure(name: string): Promise<EnsureRuntimeResult | null> {
    return runtimeCommands.ensureRuntime(name);
  }

  async download(name: string): Promise<void> {
    await runtimeCommands.downloadRuntime(name);
  }

  async list(): Promise<InstalledRuntimeInfo[]> {
    return (await runtimeCommands.listRuntimes()) ?? [];
  }

  async remove(name: string): Promise<void> {
    await runtimeCommands.removeRuntime(name);
  }

  destroy(): void {
    this.unlistenProgress?.();
  }
}

export const runtimeService = new RuntimeService();
