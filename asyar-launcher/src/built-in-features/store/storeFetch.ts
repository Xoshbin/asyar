import { envService } from '../../services/envService';
import type { ApiExtension } from './state.svelte';

/**
 * Fetches the raw list of extensions from the store registry. Used by the
 * Store UI as well as the onboarding featured-extensions/themes steps. Does
 * not apply local install-status overrides — callers add those if needed.
 */
export async function fetchAllStoreItems(): Promise<ApiExtension[]> {
  const response = await fetch(`${envService.storeApiBaseUrl}/api/extensions`);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : (data.data || []);
}
