import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { registerIconElement } from 'asyar-sdk/contracts';
import { getActiveContext } from '../context.js';

export interface MountRaycastViewOptions {
  /** Target DOM element ID (defaults to 'root', falls back to 'app') */
  containerId?: string;
  /** Fallback command name if URL query param does not match */
  fallbackCommand?: string;
  /** Additional arguments passed to the command component */
  arguments?: Record<string, unknown>;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (typeof window !== 'undefined' && window.parent) {
      window.parent.postMessage(
        {
          type: 'asyar:feedback:uncaught',
          payload: {
            kind: 'iframe_uncaught',
            developerDetail: `${error.stack || error.message}\nComponent Stack: ${errorInfo.componentStack}`,
          },
        },
        '*',
      );
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          data-testid="raycast-error-boundary"
          style={{
            padding: '24px',
            fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
            color: 'var(--text-primary, #ffffff)',
            backgroundColor: 'var(--bg-base, #1e1e1e)',
            height: '100%',
            boxSizing: 'border-box',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              color: 'var(--accent-danger, #ff6b6b)',
              fontWeight: 600,
              fontSize: '16px',
              marginBottom: '8px',
            }}
          >
            Extension Error
          </div>
          <div
            style={{
              fontSize: '13px',
              color: 'var(--text-secondary, #aaaaaa)',
              marginBottom: '16px',
            }}
          >
            {this.state.error?.message || 'An unexpected error occurred while rendering.'}
          </div>
          {this.state.error?.stack && (
            <pre
              style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--text-muted, #888888)',
                backgroundColor: 'var(--bg-surface, rgba(255, 255, 255, 0.05))',
                padding: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
              }}
            >
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Resolves which command name to activate based on URL query params (?view= or ?component=)
 * and available registered commands.
 */
export function resolveActiveCommandName(
  searchString: string = typeof window !== 'undefined' ? window.location.search : '',
  availableCommands: string[] = [],
  fallback?: string,
): string | null {
  const params = new URLSearchParams(searchString);
  const requested = params.get('view') || params.get('component');
  if (requested && availableCommands.includes(requested)) {
    return requested;
  }
  if (fallback && availableCommands.includes(fallback)) {
    return fallback;
  }
  return availableCommands[0] ?? null;
}

/**
 * Mounts a Raycast view command inside Asyar's Tier 2 view iframe.
 */
export function mountRaycastView(
  commands: Record<string, React.ComponentType<any>>,
  options?: MountRaycastViewOptions,
): Root | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  // Ensure role is set to 'view'
  if (!(window as any).__ASYAR_ROLE__) {
    (window as any).__ASYAR_ROLE__ = 'view';
  }

  // Register icon custom element if DOM is available
  try {
    registerIconElement();
  } catch {
    // Ignore if already registered
  }

  // Active context setup
  const context = getActiveContext();
  const extId = (context as any)?.extensionId || 'org.asyar.raycast-extension';

  // Inform parent host that view iframe is loaded
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      { type: 'asyar:extension:loaded', extensionId: extId, role: 'view' },
      '*',
    );
  }

  // Find or create container element
  const containerId = options?.containerId ?? 'root';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.getElementById('app');
  }
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.style.height = '100%';
    document.body.appendChild(container);
  }

  const commandNames = Object.keys(commands);
  const activeName = resolveActiveCommandName(
    window.location.search,
    commandNames,
    options?.fallbackCommand,
  );

  const Component = activeName ? commands[activeName] : null;
  const root = createRoot(container);

  if (!Component) {
    root.render(
      <div
        data-testid="raycast-no-command"
        style={{
          padding: '24px',
          color: 'var(--text-secondary, #aaaaaa)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        No view command found matching "{activeName ?? 'unknown'}".
      </div>,
    );
    return root;
  }

  // Collect launch arguments from query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const launchArgs: Record<string, unknown> = { ...options?.arguments };
  for (const [key, value] of urlParams.entries()) {
    if (key !== 'view' && key !== 'component') {
      launchArgs[key] = value;
    }
  }

  root.render(
    <ErrorBoundary>
      <Component arguments={launchArgs} />
    </ErrorBoundary>,
  );

  return root;
}
