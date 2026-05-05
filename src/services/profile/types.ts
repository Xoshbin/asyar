// asyar-launcher/src/services/profile/types.ts

export type ConflictStrategy = 'replace' | 'merge' | 'skip';

/**
 * Per-item shape for delta cloud sync. The id is provider-supplied
 * (clipboard items have UUIDs already; settings is the singleton id
 * "settings"). The content is the JSON-serializable per-item data.
 */
export interface SyncItem {
  id: string;
  categoryId: string;
  content: unknown;
}

/**
 * Local change event. The provider emits one of these whenever its
 * underlying data changes locally, so the cloud sync service can mark
 * the item dirty in the Rust journal for the next push tick.
 *
 * The `itemId` value `'*'` is a reserved sentinel meaning "this category's
 * change set is unknown — re-export and diff against the journal." It's
 * used by providers (e.g. extensions) whose underlying change source
 * doesn't carry per-item identity. Consumers (cloudSyncService) interpret
 * `'*'` by re-exporting the whole category and letting hash-based dirty
 * tracking handle the rest.
 */
export type SyncChangeEvent =
  | { type: 'upsert'; itemId: string; categoryId: string }
  | { type: 'delete'; itemId: string; categoryId: string };

/** Returned by `subscribeToChanges`. Calling it stops the subscription. */
export type Unsubscribe = () => void;

export interface BinaryAsset {
  id: string;
  filename: string;
  mimeType: string;
  /** Relative path within the ZIP archive (e.g., 'assets/clipboard/img-abc.png') */
  archivePath: string;
}

export interface SyncProviderData {
  providerId: string;
  version: number;           // Schema version for forward/backward compat
  exportedAt: number;        // Timestamp
  data: unknown;             // The actual payload — provider-specific
  binaryAssets?: BinaryAsset[]; // Images, files — only present in exportFull()
}

export interface ImportPreview {
  localCount: number;
  incomingCount: number;
  conflicts: number;         // Items that exist in both with different content
  newItems: number;          // Items only in incoming
  removedItems: number;      // Items only in local (would be lost on 'replace')
}

export interface ImportResult {
  success: boolean;
  itemsAdded: number;
  itemsUpdated: number;
  itemsRemoved: number;
  warnings: string[];        // e.g., "2 sensitive fields were stripped"
}

export interface DataSummary {
  itemCount: number;
  label: string;             // e.g., "20 snippets", "3 portals"
}

export interface ISyncProvider {
  /** Unique identifier: 'settings', 'snippets', 'shortcuts', 'portals', etc. */
  readonly id: string;

  /** Human-readable label for the UI checklist */
  readonly displayName: string;

  /** Icon identifier for the UI */
  readonly icon: string;

  /**
   * Sync tier — controls which cloud subscription level includes this data.
   * 'core' = always synced, 'extended' = premium tier (e.g., chat history).
   * For local import/export, all tiers are available.
   */
  readonly syncTier: 'core' | 'extended';

  /** Whether this category is included by default in "Export All" */
  readonly defaultEnabled: boolean;

  /**
   * Conflict resolution strategy for this data type.
   * 'replace' = settings-like (single truth), 'merge' = collection-like (additive).
   * User can always override in the UI.
   */
  readonly defaultConflictStrategy: 'replace' | 'merge';

  /**
   * Dot-notation paths to fields that contain sensitive data (API keys, tokens).
   * Used by the encryption layer to encrypt these fields specifically,
   * or strip them if no password is provided.
   * Examples: ['apiKey'], ['auth.token'], ['providers.openai.apiKey']
   */
  readonly sensitiveFields: string[];

  /** Export full data (for local .asyar file — may include binary references) */
  exportFull(): Promise<SyncProviderData>;

  /** Export sync-safe data (text-only, for cloud sync — no binary blobs) */
  exportForSync(): Promise<SyncProviderData>;

  /** Preview what an import would do, without applying it */
  preview(incoming: SyncProviderData): Promise<ImportPreview>;

  /** Apply import with the chosen conflict strategy */
  applyImport(incoming: SyncProviderData, strategy: ConflictStrategy): Promise<ImportResult>;

  /** Get current item count (for UI: "You have 20 snippets locally") */
  getLocalSummary(): Promise<DataSummary>;

  /**
   * Migrate data from an older providerVersion to current.
   * Called automatically if the archive's providerVersion < current.
   */
  migrate?(data: unknown, fromVersion: number): Promise<unknown>;

  /**
   * Export every item this provider manages, one entry per item.
   * Singleton-style providers (settings, ai-settings, extension-preferences)
   * return a single-element array with id equal to the categoryId.
   * Collection-style providers (clipboard, snippets, etc.) return one
   * entry per stored item using the item's existing stable identifier.
   */
  exportItems(): Promise<SyncItem[]>;

  /**
   * Apply one server-pushed item to local state — upsert semantics.
   * For singletons, this overwrites the singleton's full state.
   * For collections, this adds the item or updates the existing one
   * keyed by item.id.
   */
  applyItemUpsert(item: SyncItem): Promise<void>;

  /**
   * Apply one server-pushed delete — remove the item from local state.
   * For singletons, this typically resets to defaults or rejects (since
   * the singleton always exists). Singleton providers may throw or
   * no-op; document the choice in the implementation.
   */
  applyItemDelete(itemId: string): Promise<void>;

  /**
   * Subscribe to local changes. Whenever the provider's data changes,
   * emit a SyncChangeEvent. Returns an unsubscribe function.
   * Implementations vary: store-based providers can wrap their store's
   * existing change events; runic providers can use a custom emitter.
   */
  subscribeToChanges(callback: (event: SyncChangeEvent) => void): Unsubscribe;
}

export interface ExportOptions {
  /** Which category IDs to include. Empty = all defaultEnabled providers */
  categoryIds?: string[];
  /** Password for encrypting sensitive fields. Null = strip sensitive fields */
  password?: string | null;
  /** 'full' for local .asyar, 'sync' for cloud (text-only, no binary) */
  mode: 'full' | 'sync';
}

export interface ArchiveManifest {
  formatVersion: number;
  appVersion: string;
  exportedAt: number;
  platform: string;
  hostname: string;
  encryptionScheme: string | null;
  encryptionSalt: string | null;
  hasSensitiveData: boolean;
  categories: ArchiveCategory[];
}

export interface ArchiveCategory {
  id: string;
  displayName: string;
  file: string;
  providerVersion: number;
  itemCount: number;
  syncTier: string;
  hasSensitiveFields: boolean;
  sensitiveFieldsHandling?: 'encrypted' | 'stripped';
  hasAssets?: boolean;
}

export interface ProfileInspection {
  manifest: ArchiveManifest;
  previews: Map<string, ImportPreview>;
  hasSensitiveData: boolean;
  requiresPassword: boolean;
}

export interface ImportPlanCategory {
  id: string;
  action: 'import' | 'skip';
  strategy: ConflictStrategy;
}

export interface ImportPlan {
  /** Per-category decisions made by the user in the confirmation UI */
  categories: ImportPlanCategory[];
  password?: string | null;
}

export interface ImportReport {
  success: boolean;
  results: Map<string, ImportResult>;
  /** Categories that were skipped by user choice */
  skipped: string[];
  /** Categories that failed (e.g., migration error, decryption failure) */
  failed: Array<{ id: string; error: string }>;
}

export interface IProfileService {
  registerProvider(provider: ISyncProvider): void;
  getProviders(): ISyncProvider[];
  exportProfile(options: ExportOptions): Promise<string>;
  inspectProfile(filePath: string): Promise<ProfileInspection>;
  importProfile(filePath: string, plan: ImportPlan): Promise<ImportReport>;
}
