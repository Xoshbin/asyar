import { extBuilderStart, extBuilderAnswer, extBuilderCancel } from '../../../lib/ipc/extensionBuilderCommands';
import { serializeBuilderCommand, type BuilderCommand } from './buildProtocol';

export const sidecarClient = {
  async start(opts: { prompt: string; targetDir: string; capabilitySpecDir: string; anthropicKey: string }): Promise<void> {
    await extBuilderStart(opts);
  },
  async send(cmd: BuilderCommand): Promise<void> {
    await extBuilderAnswer(serializeBuilderCommand(cmd));
  },
  async cancel(): Promise<void> {
    await extBuilderCancel();
  },
};
