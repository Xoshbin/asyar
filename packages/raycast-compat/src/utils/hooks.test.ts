/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { usePromise } from './usePromise';
import { useCachedState } from './useCachedState';
import { useForm } from './useForm';
import { setRaycastContext } from '../context';
import type { IStorageService } from 'asyar-sdk/contracts';

describe('Raycast Utility Hooks (@raycast/utils)', () => {
  let mockStorage: Partial<IStorageService>;
  let memoryStore: Record<string, string>;

  beforeEach(() => {
    memoryStore = {};
    mockStorage = {
      get: vi.fn().mockImplementation(async (k) => memoryStore[k] ?? null),
      set: vi.fn().mockImplementation(async (k, v) => {
        memoryStore[k] = v;
      }),
      delete: vi.fn().mockImplementation(async (k) => {
        delete memoryStore[k];
        return true;
      }),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns) => {
        if (ns === 'storage') return mockStorage;
        throw new Error(`Unexpected service ${ns}`);
      }),
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  describe('usePromise', () => {
    it('manages loading, success resolution, and manual revalidation', async () => {
      let callCount = 0;
      const fetchMock = async (prefix: string) => {
        callCount++;
        return `${prefix}: data-${callCount}`;
      };

      const { result } = renderHook(() => usePromise(fetchMock, ['Test']));

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toBe('Test: data-1');

      // Trigger revalidation
      act(() => {
        result.current.revalidate();
      });

      await waitFor(() => {
        expect(result.current.data).toBe('Test: data-2');
      });
    });

    it('captures errors when promise rejects', async () => {
      const failingMock = async () => {
        throw new Error('Network timeout');
      };

      const { result } = renderHook(() => usePromise(failingMock));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error?.message).toBe('Network timeout');
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('useCachedState', () => {
    it('initializes state and persists updates to LocalStorage', async () => {
      const { result } = renderHook(() => useCachedState('user_filter', 'all'));

      expect(result.current[0]).toBe('all');

      act(() => {
        result.current[1]('archived');
      });

      expect(result.current[0]).toBe('archived');

      // Verify LocalStorage setItem was invoked
      await waitFor(() => {
        expect(mockStorage.set).toHaveBeenCalledWith('user_filter', JSON.stringify('archived'));
      });
    });
  });

  describe('useForm', () => {
    it('manages form values, itemProps binding, and validation', async () => {
      const handleSubmit = vi.fn();

      const { result } = renderHook(() =>
        useForm<{ name: string; age: string }>({
          onSubmit: handleSubmit,
          initialValues: { name: '', age: '' },
          validation: {
            name: (val) => (!val ? 'Name is required' : undefined),
            age: (val) => (val && isNaN(Number(val)) ? 'Age must be a number' : undefined),
          },
        }),
      );

      // 1. Initial values
      expect(result.current.values.name).toBe('');

      // 2. Submit with validation errors
      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.handleSubmit();
      });

      expect(success).toBe(false);
      expect(result.current.itemProps.name.error).toBe('Name is required');
      expect(handleSubmit).not.toHaveBeenCalled();

      // 3. Update field to valid value via itemProps
      act(() => {
        result.current.itemProps.name.onChange('Alice');
      });

      expect(result.current.values.name).toBe('Alice');

      // 4. Successful submit
      await act(async () => {
        success = await result.current.handleSubmit();
      });

      expect(success).toBe(true);
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Alice',
        age: '',
      });
    });
  });
});
