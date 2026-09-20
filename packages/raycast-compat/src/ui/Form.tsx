import React, { createContext, useContext, useState, useEffect } from 'react';
import { ActionPanel, type ActionDescriptor } from './ActionPanel';

// ── Form State Context ────────────────────────────────────────────────────────
interface FormContextValue {
  values: Record<string, any>;
  setValue: (id: string, value: any) => void;
  errors: Record<string, string | undefined>;
  setError: (id: string, error?: string) => void;
  submit: () => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext() {
  const ctx = useContext(FormContext);
  if (!ctx) {
    throw new Error('Form components must be rendered inside a <Form>');
  }
  return ctx;
}

// ── Form Wrapper ──────────────────────────────────────────────────────────────
export interface FormProps {
  children?: React.ReactNode;
  navigationTitle?: string;
  isLoading?: boolean;
  actions?: React.ReactNode;
}

export function Form({ children, navigationTitle, isLoading, actions }: FormProps) {
  const [values, setValues] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const setValue = (id: string, val: any) => {
    setValues((prev) => ({ ...prev, [id]: val }));
  };

  const setError = (id: string, err?: string) => {
    setErrors((prev) => ({ ...prev, [id]: err }));
  };

  // Find SubmitForm actions in `actions` prop
  let submitHandler: ((vals: Record<string, any>) => void) | undefined;
  let primaryAction: ActionDescriptor | undefined;

  if (actions && React.isValidElement(actions)) {
    const props = actions.props as any;
    const actionChildren = React.Children.toArray(props.children);
    for (const child of actionChildren) {
      if (React.isValidElement(child)) {
        const cProps = child.props as any;
        if (cProps.onSubmit) {
          submitHandler = cProps.onSubmit;
          primaryAction = {
            id: cProps.id || 'submit',
            title: cProps.title || 'Submit',
            shortcut: cProps.shortcut,
            icon: cProps.icon,
            onAction: () => cProps.onSubmit(values),
          };
          break;
        } else if (!primaryAction) {
          primaryAction = {
            id: cProps.id || 'action',
            title: cProps.title || 'Action',
            shortcut: cProps.shortcut,
            icon: cProps.icon,
            onAction: cProps.onAction,
          };
        }
      }
    }
  }

  const submit = () => {
    if (submitHandler) {
      submitHandler(values);
    }
  };

  return (
    <FormContext.Provider value={{ values, setValue, errors, setError, submit }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          background: 'var(--bg-base, #1e1e2e)',
          color: 'var(--text-primary, #ffffff)',
          fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Navigation Bar */}
        {navigationTitle && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              fontSize: '14px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{navigationTitle}</span>
            {isLoading && (
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #94a3b8)' }}>
                Loading…
              </span>
            )}
          </div>
        )}

        {/* Scrollable Form Body */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{
            flex: 1,
            padding: '20px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {children}
        </form>

        {/* Bottom Action Bar */}
        {primaryAction && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              background: 'var(--bg-surface, rgba(0, 0, 0, 0.3))',
              fontSize: '12px',
            }}
          >
            <button
              type="button"
              onClick={() => primaryAction?.onAction?.()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
                background: 'var(--accent-primary, #3b82f6)',
                color: '#ffffff',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              {primaryAction.title}
              <kbd
                style={{
                  background: 'rgba(0, 0, 0, 0.25)',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  fontSize: '10px',
                }}
              >
                ↵
              </kbd>
            </button>
          </div>
        )}
      </div>
    </FormContext.Provider>
  );
}

// ── Common Form Item Layout ───────────────────────────────────────────────────
function FormItemLayout({
  title,
  error,
  info,
  children,
}: {
  title?: string;
  error?: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label
            style={{
              fontSize: '13px',
              fontWeight: 500,
              color: 'var(--text-secondary, #94a3b8)',
            }}
          >
            {title}
          </label>
          {info && (
            <span
              title={info}
              style={{
                fontSize: '11px',
                color: 'var(--text-tertiary, #64748b)',
                cursor: 'help',
              }}
            >
              ⓘ
            </span>
          )}
        </div>
      )}
      {children}
      {error && (
        <span style={{ fontSize: '12px', color: 'var(--color-red, #ef4444)' }}>{error}</span>
      )}
    </div>
  );
}

// ── Form Subcomponents ────────────────────────────────────────────────────────

// 1. Form.TextField
export interface FormTextFieldProps {
  id: string;
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  value?: string;
  error?: string;
  info?: string;
  autoFocus?: boolean;
  onChange?: (value: string) => void;
  onBlur?: () => void;
}

export function FormTextField({
  id,
  title,
  placeholder,
  defaultValue = '',
  value,
  error,
  info,
  autoFocus,
  onChange,
  onBlur,
}: FormTextFieldProps) {
  const { values, setValue } = useFormContext();
  const currentVal = value !== undefined ? value : (values[id] ?? defaultValue);

  useEffect(() => {
    if (defaultValue && values[id] === undefined) {
      setValue(id, defaultValue);
    }
  }, [id, defaultValue]);

  return (
    <FormItemLayout title={title} error={error} info={info}>
      <input
        type="text"
        id={id}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={currentVal}
        onChange={(e) => {
          setValue(id, e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={onBlur}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          background: 'var(--bg-surface, rgba(255, 255, 255, 0.05))',
          border: error
            ? '1px solid var(--color-red, #ef4444)'
            : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: '6px',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '13px',
          outline: 'none',
        }}
      />
    </FormItemLayout>
  );
}

// 2. Form.PasswordField
export interface FormPasswordFieldProps extends FormTextFieldProps {}

export function FormPasswordField(props: FormPasswordFieldProps) {
  const { values, setValue } = useFormContext();
  const currentVal =
    props.value !== undefined ? props.value : (values[props.id] ?? props.defaultValue ?? '');

  return (
    <FormItemLayout title={props.title} error={props.error} info={props.info}>
      <input
        type="password"
        id={props.id}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={currentVal}
        onChange={(e) => {
          setValue(props.id, e.target.value);
          props.onChange?.(e.target.value);
        }}
        onBlur={props.onBlur}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          background: 'var(--bg-surface, rgba(255, 255, 255, 0.05))',
          border: props.error
            ? '1px solid var(--color-red, #ef4444)'
            : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: '6px',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '13px',
          outline: 'none',
        }}
      />
    </FormItemLayout>
  );
}

// 3. Form.TextArea
export interface FormTextAreaProps {
  id: string;
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  value?: string;
  error?: string;
  info?: string;
  autoFocus?: boolean;
  onChange?: (value: string) => void;
  onBlur?: () => void;
}

export function FormTextArea({
  id,
  title,
  placeholder,
  defaultValue = '',
  value,
  error,
  info,
  autoFocus,
  onChange,
  onBlur,
}: FormTextAreaProps) {
  const { values, setValue } = useFormContext();
  const currentVal = value !== undefined ? value : (values[id] ?? defaultValue);

  useEffect(() => {
    if (defaultValue && values[id] === undefined) {
      setValue(id, defaultValue);
    }
  }, [id, defaultValue]);

  return (
    <FormItemLayout title={title} error={error} info={info}>
      <textarea
        id={id}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={currentVal}
        rows={4}
        onChange={(e) => {
          setValue(id, e.target.value);
          onChange?.(e.target.value);
        }}
        onBlur={onBlur}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          background: 'var(--bg-surface, rgba(255, 255, 255, 0.05))',
          border: error
            ? '1px solid var(--color-red, #ef4444)'
            : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: '6px',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '13px',
          outline: 'none',
          resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />
    </FormItemLayout>
  );
}

// 4. Form.Checkbox
export interface FormCheckboxProps {
  id: string;
  label: string;
  title?: string;
  defaultValue?: boolean;
  value?: boolean;
  error?: string;
  info?: string;
  onChange?: (checked: boolean) => void;
}

export function FormCheckbox({
  id,
  label,
  title,
  defaultValue = false,
  value,
  error,
  info,
  onChange,
}: FormCheckboxProps) {
  const { values, setValue } = useFormContext();
  const currentVal = value !== undefined ? value : (values[id] ?? defaultValue);

  useEffect(() => {
    if (defaultValue && values[id] === undefined) {
      setValue(id, defaultValue);
    }
  }, [id, defaultValue]);

  return (
    <FormItemLayout title={title} error={error} info={info}>
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '13px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          id={id}
          checked={!!currentVal}
          onChange={(e) => {
            setValue(id, e.target.checked);
            onChange?.(e.target.checked);
          }}
          style={{ cursor: 'pointer' }}
        />
        <span>{label}</span>
      </label>
    </FormItemLayout>
  );
}

// 5. Form.Dropdown
export interface FormDropdownProps {
  id: string;
  title?: string;
  defaultValue?: string;
  value?: string;
  error?: string;
  info?: string;
  children?: React.ReactNode;
  onChange?: (value: string) => void;
}

export interface FormDropdownItemProps {
  value: string;
  title: string;
  icon?: string;
}

export function FormDropdownItem({ value, title, icon }: FormDropdownItemProps) {
  return <option value={value}>{icon ? `${icon} ${title}` : title}</option>;
}

export interface FormDropdownSectionProps {
  title: string;
  children?: React.ReactNode;
}

export function FormDropdownSection({ title, children }: FormDropdownSectionProps) {
  return <optgroup label={title}>{children}</optgroup>;
}

export function FormDropdown({
  id,
  title,
  defaultValue = '',
  value,
  error,
  info,
  children,
  onChange,
}: FormDropdownProps) {
  const { values, setValue } = useFormContext();
  const currentVal = value !== undefined ? value : (values[id] ?? defaultValue);

  useEffect(() => {
    if (defaultValue && values[id] === undefined) {
      setValue(id, defaultValue);
    }
  }, [id, defaultValue]);

  return (
    <FormItemLayout title={title} error={error} info={info}>
      <select
        id={id}
        value={currentVal}
        onChange={(e) => {
          setValue(id, e.target.value);
          onChange?.(e.target.value);
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          background: 'var(--bg-surface, #2a2b3d)',
          border: error
            ? '1px solid var(--color-red, #ef4444)'
            : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: '6px',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '13px',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {children}
      </select>
    </FormItemLayout>
  );
}

FormDropdown.Item = FormDropdownItem;
FormDropdown.Section = FormDropdownSection;

// 6. Form.DatePicker
export interface FormDatePickerProps {
  id: string;
  title?: string;
  type?: 'date' | 'date-time';
  defaultValue?: Date;
  value?: Date;
  error?: string;
  info?: string;
  onChange?: (date: Date | null) => void;
}

export function FormDatePicker({
  id,
  title,
  type = 'date',
  defaultValue,
  value,
  error,
  info,
  onChange,
}: FormDatePickerProps) {
  const { values, setValue } = useFormContext();
  const currentDate = value !== undefined ? value : (values[id] ?? defaultValue);

  const dateString = currentDate instanceof Date ? currentDate.toISOString().slice(0, 10) : '';

  return (
    <FormItemLayout title={title} error={error} info={info}>
      <input
        type={type === 'date-time' ? 'datetime-local' : 'date'}
        id={id}
        value={dateString}
        onChange={(e) => {
          const newDate = e.target.value ? new Date(e.target.value) : null;
          setValue(id, newDate);
          onChange?.(newDate);
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          background: 'var(--bg-surface, rgba(255, 255, 255, 0.05))',
          border: error
            ? '1px solid var(--color-red, #ef4444)'
            : '1px solid var(--border-subtle, rgba(255, 255, 255, 0.15))',
          borderRadius: '6px',
          color: 'var(--text-primary, #ffffff)',
          fontSize: '13px',
          outline: 'none',
        }}
      />
    </FormItemLayout>
  );
}

// 7. Form.Description
export interface FormDescriptionProps {
  title?: string;
  text: string;
}

export function FormDescription({ title, text }: FormDescriptionProps) {
  return (
    <FormItemLayout title={title}>
      <span
        style={{
          fontSize: '13px',
          lineHeight: '1.5',
          color: 'var(--text-secondary, #94a3b8)',
        }}
      >
        {text}
      </span>
    </FormItemLayout>
  );
}

// 8. Form.Separator
export function FormSeparator() {
  return (
    <div
      style={{
        height: '1px',
        background: 'var(--border-subtle, rgba(255, 255, 255, 0.1))',
        margin: '8px 0',
      }}
    />
  );
}

// Attach subcomponents to Form
Form.TextField = FormTextField;
Form.PasswordField = FormPasswordField;
Form.TextArea = FormTextArea;
Form.Checkbox = FormCheckbox;
Form.Dropdown = FormDropdown;
Form.DatePicker = FormDatePicker;
Form.Description = FormDescription;
Form.Separator = FormSeparator;
