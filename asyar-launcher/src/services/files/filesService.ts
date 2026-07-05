import { fileSearch, fileIndexStatus } from '../../lib/ipc/fileSearchCommands';
import type { FileHit, FileSearchOptions, IndexStatus } from 'asyar-sdk/contracts';

const DISABLED_STATUS: IndexStatus = {
  state: 'disabled',
  entryCount: 0,
  lastScanMs: 0,
  snapshotLoaded: false,
  capReached: false,
};

export class FilesService {
  async search(query: string, opts?: FileSearchOptions): Promise<FileHit[]> {
    const response = await fileSearch(query, opts?.typeFilter, opts?.limit);
    return response?.hits ?? [];
  }

  async status(): Promise<IndexStatus> {
    return (await fileIndexStatus()) ?? DISABLED_STATUS;
  }
}

export const filesService = new FilesService();
