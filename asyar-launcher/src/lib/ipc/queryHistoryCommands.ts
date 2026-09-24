import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export interface QueryHistoryCommands {
  navigate(sessionId: string, direction: -1 | 1): Promise<string | null>;
  record(query: string): Promise<boolean>;
  delete(query: string): Promise<boolean>;
  reset(): Promise<boolean>;
  list(): Promise<string[] | null>;
}

export const queryHistoryCommands: QueryHistoryCommands = {
  navigate: (sessionId: string, direction: -1 | 1) =>
    invokeSafe<string | null>('query_history_navigate', { sessionId, direction }),
  record: (query: string) => invokeSafeVoid('query_history_record', { query }),
  delete: (query: string) => invokeSafeVoid('query_history_delete', { query }),
  reset: () => invokeSafeVoid('query_history_reset'),
  list: () => invokeSafe<string[]>('query_history_list'),
};
