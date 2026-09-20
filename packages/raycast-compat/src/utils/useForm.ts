import { useState, useCallback } from 'react';

export type FormValidation<TValues> = {
  [K in keyof TValues]?: (value: TValues[K] | undefined) => string | undefined | false | null;
};

export interface UseFormOptions<TValues extends Record<string, any>> {
  onSubmit: (values: TValues) => void | Promise<void>;
  validation?: FormValidation<TValues>;
  initialValues?: Partial<TValues>;
}

export interface FormItemProps<T> {
  value: T;
  onChange: (value: T) => void;
  onBlur: () => void;
  error?: string;
}

export interface UseFormResult<TValues extends Record<string, any>> {
  handleSubmit: (values?: TValues) => boolean | Promise<boolean>;
  values: TValues;
  setValue: <K extends keyof TValues>(key: K, value: TValues[K]) => void;
  setValidationError: (key: keyof TValues, error?: string) => void;
  reset: (values?: Partial<TValues>) => void;
  itemProps: {
    [K in keyof TValues]: FormItemProps<TValues[K]>;
  };
}

export function useForm<TValues extends Record<string, any>>({
  onSubmit,
  validation,
  initialValues = {} as Partial<TValues>,
}: UseFormOptions<TValues>): UseFormResult<TValues> {
  const [values, setValues] = useState<TValues>(initialValues as TValues);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const setValue = useCallback(
    <K extends keyof TValues>(key: K, value: TValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      // Clear error on change if valid
      if (validation?.[key]) {
        const err = validation[key]!(value);
        setErrors((prev) => ({ ...prev, [key as string]: err || undefined }));
      }
    },
    [validation],
  );

  const setValidationError = useCallback((key: keyof TValues, error?: string) => {
    setErrors((prev) => ({ ...prev, [key as string]: error }));
  }, []);

  const reset = useCallback(
    (newValues?: Partial<TValues>) => {
      setValues((newValues || initialValues) as TValues);
      setErrors({});
    },
    [initialValues],
  );

  const handleSubmit = useCallback(
    async (submittedValues?: TValues): Promise<boolean> => {
      const currentValues = submittedValues || values;
      let hasError = false;
      const newErrors: Record<string, string | undefined> = {};

      if (validation) {
        for (const [key, validator] of Object.entries(validation)) {
          if (validator) {
            const err = validator((currentValues as any)[key]);
            if (err) {
              newErrors[key] = err;
              hasError = true;
            }
          }
        }
      }

      setErrors(newErrors);

      if (!hasError) {
        await onSubmit(currentValues);
        return true;
      }
      return false;
    },
    [values, validation, onSubmit],
  );

  const itemProps = new Proxy({} as any, {
    get: (_, prop: string) => {
      return {
        value: values[prop],
        onChange: (newVal: any) => setValue(prop as any, newVal),
        onBlur: () => {
          if (validation?.[prop]) {
            const err = validation[prop]!(values[prop]);
            setErrors((prev) => ({ ...prev, [prop]: err || undefined }));
          }
        },
        error: errors[prop],
      };
    },
  });

  return {
    handleSubmit,
    values,
    setValue,
    setValidationError,
    reset,
    itemProps,
  };
}
