import { useEffect } from 'react';
import { usePromise, type UsePromiseOptions, type UsePromiseResult } from './usePromise';
import { LocalStorage } from '../storage';

export interface UseCachedPromiseOptions<T> extends UsePromiseOptions<T> {
  /** Optional namespace for caching in LocalStorage */
  cacheNamespace?: string;
}

export function useCachedPromise<T, TArgs extends any[] = any[]>(
  fn: (...args: TArgs) => Promise<T>,
  args?: TArgs,
  options?: UseCachedPromiseOptions<T>,
): UsePromiseResult<T> {
  const cacheKey = `cache:promise:${options?.cacheNamespace || 'default'}:${fn.name || 'anonymous'}:${JSON.stringify(args || [])}`;

  const result = usePromise(fn, args, {
    ...options,
    onData: (data) => {
      void LocalStorage.setItem(cacheKey, data as any);
      options?.onData?.(data);
    },
  });

  // Load from cache initially if data is not yet set
  useEffect(() => {
    if (result.data === undefined) {
      LocalStorage.getItem<T>(cacheKey).then((cached) => {
        if (cached !== undefined && result.data === undefined) {
          void result.mutate(Promise.resolve(cached), { shouldRevalidate: false });
        }
      });
    }
  }, [cacheKey]);

  return result;
}
