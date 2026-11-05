import {
  IFilesService,
  FileHit,
  FileGlobOptions,
  FileReadOptions,
  FileReadRangeOptions,
  FileChunk,
  FileGlobEntry,
  FileGlobEntriesOptions,
  FileSearchOptions,
  FileThumbnailOptions,
  IndexStatus,
} from './IFilesService';
import type {
  FileSearchHandler,
  FileSearchProviderRegistration,
  FileSearchQuery,
  FileSearchResultItem,
} from '../contracts/fileSearch';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK-side proxy for the Files (file search + scoped read) Service.
 *
 * Communicates with the Launcher Host via asyar:api:files:* IPC messages.
 */
export class FilesServiceProxy extends BaseServiceProxy implements IFilesService {
  private fileSearchProviders = new Map<string, { handler: FileSearchHandler; token: symbol }>();

  async search(query: string, opts?: FileSearchOptions): Promise<FileHit[]> {
    return this.broker.invoke<FileHit[]>('files:search', { query, opts: opts ?? {} });
  }

  async status(): Promise<IndexStatus> {
    return this.broker.invoke<IndexStatus>('files:status', {});
  }

  async read(path: string, opts?: FileReadOptions): Promise<string> {
    return this.broker.invoke<string>('files:read', { path, opts: opts ?? {} });
  }

  async readRange(path: string, opts?: FileReadRangeOptions): Promise<FileChunk> {
    return this.broker.invoke<FileChunk>('files:readRange', { path, opts: opts ?? {} });
  }

  async glob(pattern: string, opts?: FileGlobOptions): Promise<string[]> {
    return this.broker.invoke<string[]>('files:glob', { pattern, opts: opts ?? {} });
  }

  async globEntries(pattern: string, opts?: FileGlobEntriesOptions): Promise<FileGlobEntry[]> {
    return this.broker.invoke<FileGlobEntry[]>('files:globEntries', { pattern, opts: opts ?? {} });
  }

  async thumbnail(path: string, opts?: FileThumbnailOptions): Promise<string | null> {
    return this.broker.invoke<string | null>('files:thumbnail', { path, opts: opts ?? {} });
  }

  registerFileSearchProvider(provider: FileSearchProviderRegistration): () => void {
    if (
      !provider ||
      typeof provider.id !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(provider.id) ||
      typeof provider.search !== 'function'
    ) {
      throw new Error(
        '[asyar-sdk/files] registerFileSearchProvider requires a provider with a valid id and search function',
      );
    }
    const token = Symbol();
    this.fileSearchProviders.set(provider.id, { handler: provider.search, token });
    return () => {
      const current = this.fileSearchProviders.get(provider.id);
      if (current?.token === token) {
        this.fileSearchProviders.delete(provider.id);
      }
    };
  }

  async invokeFileSearchHandler(
    providerId: string,
    query: FileSearchQuery,
    signal: AbortSignal,
  ): Promise<FileSearchResultItem[]> {
    if (typeof providerId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(providerId)) {
      throw new Error(`[asyar-sdk/files] Invalid file search provider ID: "${providerId}"`);
    }
    const registered = this.fileSearchProviders.get(providerId);
    if (!registered) {
      throw new Error(
        `[asyar-sdk/files] No search handler registered for file search provider: "${providerId}"`,
      );
    }
    return registered.handler(query, signal);
  }
}
