import type {
  ISyncProvider,
  SyncProviderData,
  ExportOptions,
  ArchiveManifest,
  ArchiveCategory,
} from './types';

export class ProfileService {
  private providers: Map<string, ISyncProvider> = new Map();

  registerProvider(provider: ISyncProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider "${provider.id}" is already registered`);
    }
    this.providers.set(provider.id, provider);
  }

  getProviders(): ISyncProvider[] {
    return Array.from(this.providers.values());
  }

  getProviderById(id: string): ISyncProvider | undefined {
    return this.providers.get(id);
  }

  async collectExportData(
    options: Pick<ExportOptions, 'mode' | 'categoryIds'>,
  ): Promise<Map<string, SyncProviderData>> {
    const selectedProviders = this.resolveProviders(options.categoryIds);
    const result = new Map<string, SyncProviderData>();

    for (const provider of selectedProviders) {
      const data =
        options.mode === 'sync'
          ? await provider.exportForSync()
          : await provider.exportFull();
      result.set(provider.id, data);
    }

    return result;
  }

  buildManifest(
    exportData: Map<string, SyncProviderData>,
    password: string | null | undefined,
  ): ArchiveManifest {
    const categories: ArchiveCategory[] = [];
    let hasSensitiveData = false;

    for (const [providerId, data] of exportData) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const hasSensitiveFields = provider.sensitiveFields.length > 0;
      if (hasSensitiveFields) hasSensitiveData = true;

      const itemCount = Array.isArray(data.data) ? data.data.length : 1;

      categories.push({
        id: provider.id,
        displayName: provider.displayName,
        file: `${provider.id}.json`,
        providerVersion: data.version,
        itemCount,
        syncTier: provider.syncTier,
        hasSensitiveFields,
        sensitiveFieldsHandling: hasSensitiveFields
          ? password
            ? 'encrypted'
            : 'stripped'
          : undefined,
        hasAssets: data.binaryAssets && data.binaryAssets.length > 0 ? true : undefined,
      });
    }

    const salt = hasSensitiveData && password ? generateSalt() : null;

    return {
      formatVersion: 1,
      appVersion: '', // Filled by caller from Tauri getVersion()
      exportedAt: Date.now(),
      platform: '', // Filled by caller
      hostname: '', // Filled by caller
      encryptionScheme: hasSensitiveData && password ? 'aes-256-gcm' : null,
      encryptionSalt: salt,
      hasSensitiveData,
      categories,
    };
  }

  private resolveProviders(categoryIds?: string[]): ISyncProvider[] {
    if (categoryIds && categoryIds.length > 0) {
      return categoryIds
        .map((id) => this.providers.get(id))
        .filter((p): p is ISyncProvider => p !== undefined);
    }
    return this.getProviders().filter((p) => p.defaultEnabled);
  }
}

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export const profileService = new ProfileService();
