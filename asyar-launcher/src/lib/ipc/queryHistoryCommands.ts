import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export const queryHistoryCommands = {
  list: () => invokeSafe<string[]>('query_history_list'),
  record: (query: string) => invokeSafeVoid('query_history_record', { query }),
  delete: (query: string) => invokeSafeVoid('query_history_delete', { query }),
};
