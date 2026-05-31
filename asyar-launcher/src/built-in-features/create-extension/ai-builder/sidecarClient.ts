import { invoke } from '@tauri-apps/api/core';
import { serializeBuilderCommand, type BuilderCommand } from './buildProtocol';

export const sidecarClient = {
  start(opts: { prompt: string; targetDir: string; capabilitySpecDir: string; anthropicKey: string }): Promise<void> {
    return invoke('ext_builder_start', {
      prompt: opts.prompt,
      targetDir: opts.targetDir,
      capabilitySpecDir: opts.capabilitySpecDir,
      anthropicKey: opts.anthropicKey,
    });
  },
  send(cmd: BuilderCommand): Promise<void> {
    return invoke('ext_builder_answer', { line: serializeBuilderCommand(cmd) });
  },
  cancel(): Promise<void> {
    return invoke('ext_builder_cancel');
  },
};
