import { IFilesService, FileHit, FileSearchOptions, IndexStatus } from './IFilesService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK-side proxy for the Files (file search) Service.
 *
 * Communicates with the Launcher Host via asyar:api:files:* IPC messages.
 */
export class FilesServiceProxy extends BaseServiceProxy implements IFilesService {
  async search(query: string, opts?: FileSearchOptions): Promise<FileHit[]> {
    return this.broker.invoke<FileHit[]>('files:search', { query, opts: opts ?? {} });
  }

  async status(): Promise<IndexStatus> {
    return this.broker.invoke<IndexStatus>('files:status', {});
  }
}
