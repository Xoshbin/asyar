import type { IProviderPlugin, ProviderId } from './IProviderPlugin';

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, IProviderPlugin>();

  /** Register a provider descriptor. Replaces an existing entry with the same id. */
  register(plugin: IProviderPlugin): void {
    this.providers.set(plugin.id, plugin);
  }

  get(id: ProviderId): IProviderPlugin | undefined {
    return this.providers.get(id);
  }

  list(): IProviderPlugin[] {
    return Array.from(this.providers.values());
  }

  clearForTesting(): void {
    this.providers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();
