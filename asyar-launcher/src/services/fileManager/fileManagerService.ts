import * as commands from '../../lib/ipc/commands';

export const fileManagerService = {
  async showInFileManager(path: string): Promise<void> {
    return commands.showInFileManager(path);
  },
  async trash(path: string): Promise<void> {
    return commands.trashPath(path);
  },
};
