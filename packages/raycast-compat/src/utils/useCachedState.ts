import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalStorage } from '../storage';

export interface UseCachedStateOptions {
  cacheNamespace?: string;
}

export function useCachedState<T>(
  key: string,
  initialValue: T,
  options?: UseCachedStateOptions,
): [T, (value: T | ((prevState: T) => T)) => void] {
  const fullKey = options?.cacheNamespace ? `${options.cacheNamespace}:${key}` : key;
  const [state, setState] = useState<T>(initialValue);
  const isLoadedRef = useRef(false);

  // Load from LocalStorage on mount
  useEffect(() => {
    let isCancelled = false;
    LocalStorage.getItem<T>(fullKey).then((cached) => {
      if (!isCancelled && cached !== undefined) {
        setState(cached);
      }
      isLoadedRef.current = true;
    });

    return () => {
      isCancelled = true;
    };
  }, [fullKey]);

  // Wrapped updater that saves to LocalStorage
  const setCachedState = useCallback(
    (updater: T | ((prevState: T) => T)) => {
      setState((prev) => {
        const nextValue = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
        void LocalStorage.setItem(fullKey, nextValue as any);
        return nextValue;
      });
    },
    [fullKey],
  );

  return [state, setCachedState];
}
