import { logService } from '../log/logService';

export class LaunchCommandError extends Error {
  constructor(
    public readonly code: 'EXTENSION_NOT_FOUND' | 'COMMAND_NOT_FOUND',
    message: string
  ) {
    super(message);
    this.name = 'LaunchCommandError';
  }
}

export interface InteropDeps {
  hasCommand: (objectId: string) => boolean;
  getManifestById: (id: string) => unknown;
  handleCommandAction: (objectId: string, args?: Record<string, unknown>) => Promise<any>;
}

export class InteropService {
  constructor(private deps: InteropDeps) {}

  async launchCommand(
    callerExtensionId: string,
    extensionId: string,
    commandId: string,
    args?: Record<string, unknown>
  ): Promise<void> {
    logService.debug(`[InteropService] ${callerExtensionId} → ${extensionId}/${commandId}`);
    const objectId = `cmd_${extensionId}_${commandId}`;

    if (!this.deps.hasCommand(objectId)) {
      if (!this.deps.getManifestById(extensionId)) {
        throw new LaunchCommandError(
          'EXTENSION_NOT_FOUND',
          `Extension "${extensionId}" is not installed`
        );
      }
      throw new LaunchCommandError(
        'COMMAND_NOT_FOUND',
        `Command "${commandId}" not found in extension "${extensionId}"`
      );
    }

    return this.deps.handleCommandAction(objectId, args);
  }
}
