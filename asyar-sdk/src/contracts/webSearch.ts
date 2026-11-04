/**
 * Contracts for the Web Search Engine Service Provider Interface (SPI).
 * Allows Tier 2 extensions to contribute custom web search engines to Asyar.
 */

/**
 * Normalized grounding source entry for citations and interactive pills in Chat UI.
 */
export interface GroundingSource {
  title: string;
  url: string;
}

/**
 * Normalized search result entry with snippet for LLM context injection.
 */
export interface SearchResultEntry {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Normalized output shape returned by every search engine handler.
 */
export interface WebSearchResult {
  sources: GroundingSource[];
  results: SearchResultEntry[];
}

/**
 * Query payload dispatched from the host to the extension worker.
 */
export interface WebSearchQuery {
  query: string;
  limit: number;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Search handler callback executed inside the extension worker.
 */
export type WebSearchHandler = (
  query: WebSearchQuery,
  signal: AbortSignal,
) => Promise<WebSearchResult>;

/**
 * Registration descriptor passed to context.ai.registerWebSearchEngine.
 */
export interface WebSearchEngineRegistration {
  id: string;
  search: WebSearchHandler;
}

/**
 * Manifest declaration shape for a contributed web search engine.
 */
export interface ManifestWebSearchEngine {
  id: string;
  name: string;
  description?: string;
  homepage?: string;
  requiresApiKey?: boolean;
  apiKeyOptional?: boolean;
  apiKeyPlaceholder?: string;
  apiKeyHelpUrl?: string;
  requiresBaseUrl?: boolean;
  baseUrlPlaceholder?: string;
  icon?: string;
}
