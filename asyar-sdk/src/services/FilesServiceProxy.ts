import {
  IFilesService,
  FileHit,
  FileGlobOptions,
  FileReadOptions,
  FileSearchOptions,
  FileThumbnailOptions,
  IndexStatus,
} from './IFilesService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK-side proxy for the Files (file search + scoped read) Service.
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

  async read(path: string, opts?: FileReadOptions): Promise<string> {
    return this.broker.invoke<string>('files:read', { path, opts: opts ?? {} });
  }

  async glob(pattern: string, opts?: FileGlobOptions): Promise<string[]> {
    return this.broker.invoke<string[]>('files:glob', { pattern, opts: opts ?? {} });
  }

  async thumbnail(path: string, opts?: FileThumbnailOptions): Promise<string | null> {
    return this.broker.invoke<string | null>('files:thumbnail', { path, opts: opts ?? {} });
  }
}
