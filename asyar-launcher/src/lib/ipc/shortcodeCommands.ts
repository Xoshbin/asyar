import { invokeSafeVoid } from './invokeSafe';

// `contribute_shortcodes`/`revoke_shortcodes` are `Result<(), AppError>` on
// the Rust side. `invokeSafeVoid` resolves `true` for Ok(()) and rejects with
// `IpcError` for command or transport failures.

export async function contributeShortcodes(
  extensionId: string | undefined,
  map: Record<string, string>,
): Promise<boolean> {
  return invokeSafeVoid('contribute_shortcodes', { extensionId, map });
}

export async function revokeShortcodes(extensionId: string | undefined): Promise<boolean> {
  return invokeSafeVoid('revoke_shortcodes', { extensionId });
}
