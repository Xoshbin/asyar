import { useState, useEffect, useCallback, useRef } from 'react';

export interface UsePromiseOptions<T> {
  /** Whether the promise should be executed. Defaults to true. */
  execute?: boolean;
  /** Initial data before the promise resolves. */
  initialData?: T;
  /** Callback executed when promise resolves successfully. */
  onData?: (data: T) => void;
  /** Callback executed when promise rejects. */
  onError?: (error: Error) => void;
  /** AbortController signal support. */
  abortable?: React.MutableRefObject<AbortController | null | undefined>;
}

export interface UsePromiseResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  revalidate: () => void;
  mutate: (
    asyncUpdate?: Promise<any> | ((currentData: T | undefined) => T),
    options?: { shouldRevalidate?: boolean },
  ) => Promise<void>;
}

export function usePromise<T, TArgs extends any[] = any[]>(
  fn: (...args: TArgs) => Promise<T>,
  args?: TArgs,
  options?: UsePromiseOptions<T>,
): UsePromiseResult<T> {
  const [data, setData] = useState<T | undefined>(options?.initialData);
  const [isLoading, setIsLoading] = useState<boolean>(options?.execute !== false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [revalidateCount, setRevalidateCount] = useState<number>(0);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const onDataRef = useRef(options?.onData);
  onDataRef.current = options?.onData;

  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;

  const revalidate = useCallback(() => {
    setRevalidateCount((c) => c + 1);
  }, []);

  const mutate = useCallback(
    async (
      asyncUpdate?: Promise<any> | ((currentData: T | undefined) => T),
      mutateOptions?: { shouldRevalidate?: boolean },
    ) => {
      if (typeof asyncUpdate === 'function') {
        setData((current) => (asyncUpdate as (c: T | undefined) => T)(current));
      } else if (asyncUpdate instanceof Promise) {
        setIsLoading(true);
        try {
          const res = await asyncUpdate;
          if (res !== undefined) {
            setData(res);
          }
        } catch (err: any) {
          setError(err instanceof Error ? err : new Error(String(err)));
        } finally {
          setIsLoading(false);
        }
      }

      if (mutateOptions?.shouldRevalidate !== false) {
        revalidate();
      }
    },
    [revalidate],
  );

  useEffect(() => {
    if (options?.execute === false) {
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();
    if (options?.abortable) {
      options.abortable.current = controller;
    }

    setIsLoading(true);
    setError(undefined);

    const callArgs = (args || []) as TArgs;

    fnRef
      .current(...callArgs)
      .then((result) => {
        if (!isCancelled) {
          setData(result);
          setIsLoading(false);
          onDataRef.current?.(result);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          const errObj = err instanceof Error ? err : new Error(String(err));
          setError(errObj);
          setIsLoading(false);
          onErrorRef.current?.(errObj);
        }
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [revalidateCount, options?.execute, JSON.stringify(args)]);

  return {
    data,
    isLoading,
    error,
    revalidate,
    mutate,
  };
}
