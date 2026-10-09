/**
 * Launcher version that stops accepting manifest `actions`.
 *
 * Manifest-declared root-search actions were removed: actions live inside the
 * extension's view now. Until this version the launcher still loads manifests
 * that declare them (ignoring the field) so published extensions keep working.
 * Kept in sync by hand with the `remove in 0.2.0` marker in
 * `asyar-launcher/src-tauri/src/extensions/discovery.rs` and the guard test
 * `asyar-launcher/src/services/extension/manifestActionsDeadline.test.ts`.
 */
export const MANIFEST_ACTIONS_REMOVED_IN = '0.2.0';

/** The deprecation notice shown by `asyar build` and `asyar validate`. */
export function manifestActionsWarning(): string {
  return (
    `Manifest \`actions\` are no longer supported and are ignored; the launcher rejects the ` +
    `field from ${MANIFEST_ACTIONS_REMOVED_IN}. Register actions inside your view instead ` +
    `(\`context.actions.registerAction\`), or declare another command.`
  );
}
