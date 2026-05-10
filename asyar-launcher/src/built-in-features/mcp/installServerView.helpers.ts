import type { McpServerInstallInput } from './types';

export interface EnvRow {
  key: string;
  value: string;
}

export interface InstallFormState {
  id: string;
  displayName: string;
  description: string;
  transportKind: 'stdio' | 'http';
  command: string;
  args: string[];
  env: EnvRow[];
  cwd: string;
  url: string;
  headers: EnvRow[];
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateInstallForm(state: InstallFormState): ValidationResult {
  if (!state.id.trim()) {
    return { ok: false, error: 'ID is required.' };
  }
  if (!state.displayName.trim()) {
    return { ok: false, error: 'Display name is required.' };
  }
  if (state.transportKind === 'stdio') {
    if (!state.command.trim()) {
      return { ok: false, error: 'Command is required for stdio transport.' };
    }
  } else {
    if (!/^https?:\/\/.+/.test(state.url)) {
      return { ok: false, error: 'A valid URL starting with http:// or https:// is required.' };
    }
  }
  return { ok: true };
}

export function buildInstallInput(state: InstallFormState): McpServerInstallInput {
  const description = state.description.trim() || null;

  if (state.transportKind === 'stdio') {
    const env: Record<string, string> = {};
    for (const row of state.env) {
      if (row.key.trim()) {
        env[row.key] = row.value;
      }
    }
    const args = state.args.filter((a) => a.trim() !== '');
    const cwd = state.cwd.trim() || null;
    return {
      id: state.id.trim(),
      displayName: state.displayName.trim(),
      description,
      transport: { kind: 'stdio', command: state.command.trim(), args, env, cwd },
    };
  } else {
    const headers: Record<string, string> = {};
    for (const row of state.headers) {
      if (row.key.trim()) {
        headers[row.key] = row.value;
      }
    }
    return {
      id: state.id.trim(),
      displayName: state.displayName.trim(),
      description,
      transport: { kind: 'http', url: state.url.trim(), headers },
    };
  }
}
