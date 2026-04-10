export interface IInteropService {
  /**
   * Invoke a command from another installed extension.
   * Requires `extension:invoke` permission in manifest.
   * 
   * @param extensionId - The target extension's manifest id (e.g. 'com.example.calc')
   * @param commandId   - The command's id as declared in the target manifest (e.g. 'run')
   * @param args        - Optional arguments forwarded to the command
   */
  launchCommand(
    extensionId: string,
    commandId: string,
    args?: Record<string, unknown>
  ): Promise<void>
}

export class LaunchCommandError extends Error {
  constructor(
    public readonly code: 'EXTENSION_NOT_FOUND' | 'COMMAND_NOT_FOUND',
    message: string
  ) {
    super(message)
    this.name = 'LaunchCommandError'
  }
}
