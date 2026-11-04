/**
 * Contracts for the Web Content Scraper / Markdown Reader Service Provider Interface (SPI).
 * Allows Tier 2 extensions to contribute custom web scrapers and Markdown readers to Asyar.
 */

/**
 * Payload dispatched from the host to the extension worker.
 */
export interface WebReaderQuery {
  url: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Normalized output shape returned by every web reader handler.
 */
export interface WebReaderResult {
  url: string;
  title?: string;
  content: string; // Clean Markdown or extracted text for LLM context
  status?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Reader handler callback executed inside the extension worker.
 */
export type WebReaderHandler = (
  query: WebReaderQuery,
  signal: AbortSignal,
) => Promise<WebReaderResult>;

/**
 * Registration descriptor passed to context.ai.registerWebReader.
 */
export interface WebReaderEngineRegistration {
  id: string;
  read: WebReaderHandler;
}

/**
 * Manifest declaration shape for a contributed web reader.
 */
export interface ManifestWebReader {
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
