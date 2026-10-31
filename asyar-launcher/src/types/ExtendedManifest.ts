import type { ExtensionCommand, ExtensionManifest, ManifestAction } from 'asyar-sdk/contracts';
import type { ResolvedIcon } from '../bindings';

/** Display icon filled by Rust discovery (`ExtensionManifest::resolve_icons`). */
interface WithResolvedIcon {
  resolvedIcon?: ResolvedIcon;
}

export type HostManifestAction = ManifestAction & WithResolvedIcon;

/** A command as the host holds it; `resolvedIcon` already falls back to the extension's. */
export type HostCommand = ExtensionCommand &
  WithResolvedIcon & {
    actions?: HostManifestAction[];
  };

/**
 * Extended manifest type that includes fields not yet in the SDK's
 * ExtensionManifest type. Once the SDK adds these fields, this type
 * can be deleted and all consumers can import ExtensionManifest directly.
 */
export interface ExtendedManifest extends ExtensionManifest, WithResolvedIcon {
  commands: HostCommand[];
  actions?: HostManifestAction[];
  permissions?: string[];
  /**
   * Sidecar value bag for parameterized permissions. Key must also appear
   * in `permissions`. Currently `fs:watch` → string[] of glob patterns.
   */
  permissionArgs?: Record<string, unknown>;
  main?: string;
}
