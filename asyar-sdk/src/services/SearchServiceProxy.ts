import { ISearchService, RankableItem } from './ISearchService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK-side proxy for the Search (ranking) Service.
 *
 * Communicates with the Launcher Host via asyar:api:search:* IPC messages.
 */
export class SearchServiceProxy extends BaseServiceProxy implements ISearchService {
  async rank(query: string, items: RankableItem[]): Promise<string[]> {
    return this.broker.invoke<string[]>('search:rank', { query, items });
  }
}
