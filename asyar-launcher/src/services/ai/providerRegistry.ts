import type { IProviderPlugin, ProviderId } from './IProviderPlugin';

const registry = new Map<ProviderId, IProviderPlugin>();

/** Register a provider plugin. Replaces any existing registration for the same id. */
export function registerProvider(plugin: IProviderPlugin): void {
  registry.set(plugin.id, plugin);
}

/** Get a provider plugin by id. Returns undefined if not registered. */
export function getProvider(id: ProviderId): IProviderPlugin | undefined {
  return registry.get(id);
}

/** List all registered provider plugins, in registration order. */
export function listProviders(): IProviderPlugin[] {
  return Array.from(registry.values());
}

/** Clear all registered providers — for testing only. */
export function _clearRegistryForTesting(): void {
  registry.clear();
}
