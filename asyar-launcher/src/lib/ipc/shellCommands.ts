import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export interface ShellDescriptor {
  spawnId: string;
  program: string;
  args: string[];
  pid: number;
  startedAt: number;
}

export async function shellResolvePath(program: string): Promise<string | null> {
  return invokeSafe<string>('shell_resolve_path', { program });
}

// `shell_kill`/`shell_spawn`/`shell_grant_trust` are all `Result<(), AppError>`
// on the Rust side — Ok(()) and invokeSafe's failure sentinel both serialize
// to `null`, so these use invokeSafeVoid's boolean signal instead.

export async function shellKill(spawnId: string): Promise<boolean> {
  return invokeSafeVoid('shell_kill', { spawnId });
}

export async function shellSpawn(
  extensionId: string,
  spawnId: string,
  program: string,
  args: string[],
): Promise<boolean> {
  return invokeSafeVoid('shell_spawn', { extensionId, spawnId, program, args });
}

export async function shellList(extensionId: string): Promise<ShellDescriptor[] | null> {
  return invokeSafe<ShellDescriptor[]>('shell_list', { extensionId });
}

export async function shellAttach(
  extensionId: string,
  spawnId: string,
): Promise<ShellDescriptor | null> {
  return invokeSafe<ShellDescriptor>('shell_attach', { extensionId, spawnId });
}

export async function shellCheckTrust(
  extensionId: string,
  binaryPath: string,
): Promise<boolean | null> {
  return invokeSafe<boolean>('shell_check_trust', { extensionId, binaryPath });
}

export async function shellGrantTrust(extensionId: string, binaryPath: string): Promise<boolean> {
  return invokeSafeVoid('shell_grant_trust', { extensionId, binaryPath });
}
