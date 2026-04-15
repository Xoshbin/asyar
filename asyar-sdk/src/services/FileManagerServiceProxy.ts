import type { IFileManagerService } from './IFileManagerService';
import { BaseServiceProxy } from './BaseServiceProxy';

export class FileManagerServiceProxy extends BaseServiceProxy implements IFileManagerService {
  async showInFileManager(path: string): Promise<void> {
    return this.broker.invoke<void>('fs:showInFileManager', { path });
  }

  async trash(path: string): Promise<void> {
    return this.broker.invoke<void>('fs:trash', { path });
  }
}
