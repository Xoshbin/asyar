import type { ExtensionResult } from "asyar-api";

/**
 * Provider for search results from different sources
 */
export interface ISearchProvider {
  /**
   * Unique identifier for this search provider
   */
  id: string;

  /**
   * Search using this provider
   */
  search(query: string): Promise<ExtensionResult[]>;

  /**
   * Get default results when no query is provided
   */
  getDefaultResults?(): Promise<ExtensionResult[]>;

  /**
   * Priority of this provider (higher values = higher priority)
   */
  priority?: number;
}

/**
 * Centralized search service interface
 */
export interface ISearchService {
  /**
   * Initialize the search service
   */
  init(): Promise<boolean>;

  /**
   * Search across all registered providers
   */
  search(query: string): Promise<ExtensionResult[]>;

  /**
   * Register a search provider
   */
  registerProvider(provider: ISearchProvider): void;

  /**
   * Unregister a search provider
   */
  unregisterProvider(providerId: string): void;

  /**
   * Get default search results when no query is provided
   */
  getDefaultResults(): Promise<ExtensionResult[]>;

  /**
   * Clear search results cache
   */
  clearCache(): void;
}
