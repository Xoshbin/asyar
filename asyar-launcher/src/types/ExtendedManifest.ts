import type { ExtensionManifest } from 'asyar-sdk';

/**
 * Extended manifest type that includes fields not yet in the SDK's
 * ExtensionManifest type. Once the SDK adds these fields, this type
 * can be deleted and all consumers can import ExtensionManifest directly.
 */
export interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
  main?: string;
}
