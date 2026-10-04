import { envService } from '../../services/envService';
import type { ApiExtension } from './state.svelte';

/**
 * The registry answers with either a bare array or a paginated envelope.
 * `data` is annotated at the call site below because inferring it would be
 * circular: `response` -> `data` -> `url` -> `response`.
 */
type StorePage = {
  data?: ApiExtension[];
  next_page_url?: string | null;
};

/**
 * Fetches the raw list of extensions from the store registry. Used by the
 * Store UI as well as the onboarding featured-extensions/themes steps. Does
 * not apply local install-status overrides — callers add those if needed.
 */
export async function fetchAllStoreItems(): Promise<ApiExtension[]> {
  const items: ApiExtension[] = [];
  let url: string | null = `${envService.storeApiBaseUrl}/api/extensions?per_page=100`;
  let pageCount = 0;
  const maxPages = 20;

  while (url && pageCount < maxPages) {
    pageCount++;
    const response: Response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: ApiExtension[] | StorePage | null = await response.json();
    if (Array.isArray(data)) {
      items.push(...data);
      break;
    }
    if (data?.data && Array.isArray(data.data)) {
      items.push(...data.data);
    } else {
      break;
    }
    url = data?.next_page_url ?? null;
  }

  return items;
}
