import type { IStatusBarItem } from './IStatusBarService';

/** Maximum submenu nesting depth. Top-level items are depth 1. */
export const MAX_STATUS_BAR_DEPTH = 4;

/**
 * Validate a top-level status-bar tree client-side before sending it over
 * the broker. Mirrors the Rust `validate_top_level` rules. Throws a
 * `StatusBarValidationError` on the first violation.
 */
export function validateTopLevelStatusBarItem(item: IStatusBarItem): void {
  if (!item || typeof item !== 'object') {
    throw new StatusBarValidationError('Status-bar item must be an object');
  }
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    throw new StatusBarValidationError(
      'Top-level status-bar item id must be a non-empty string',
    );
  }
  if (typeof item.text !== 'string') {
    throw new StatusBarValidationError(
      `Top-level status-bar item '${item.id}' requires a string 'text' field`,
    );
  }
  if (item.separator === true) {
    throw new StatusBarValidationError(
      `Top-level status-bar items cannot be separators (item '${item.id}')`,
    );
  }
  if (item.checked !== undefined) {
    throw new StatusBarValidationError(
      `Top-level status-bar items cannot have a checked state (item '${item.id}')`,
    );
  }
  if (item.enabled === false) {
    throw new StatusBarValidationError(
      `Top-level status-bar items cannot be disabled (item '${item.id}')`,
    );
  }
  const hasIcon =
    (typeof item.icon === 'string' && item.icon.length > 0) ||
    (typeof item.iconPath === 'string' && item.iconPath.length > 0);
  if (!hasIcon) {
    throw new StatusBarValidationError(
      `Top-level status-bar item '${item.id}' must provide 'icon' or 'iconPath'`,
    );
  }
  if (item.id.includes(':')) {
    throw new StatusBarValidationError(
      `Status-bar item id '${item.id}' cannot contain ':' (reserved path separator)`,
    );
  }

  if (Array.isArray(item.submenu)) {
    validateSiblings(item.submenu, 2);
  } else if (item.submenu !== undefined) {
    throw new StatusBarValidationError(
      `submenu on item '${item.id}' must be an array when present`,
    );
  }
}

function validateSiblings(items: IStatusBarItem[], depth: number): void {
  if (depth > MAX_STATUS_BAR_DEPTH) {
    throw new StatusBarValidationError(
      `Status-bar submenu nested deeper than max depth ${MAX_STATUS_BAR_DEPTH}`,
    );
  }
  const seenIds = new Set<string>();
  for (const child of items) {
    if (!child || typeof child !== 'object') {
      throw new StatusBarValidationError('Submenu item must be an object');
    }
    if (child.separator === true) {
      if (child.submenu !== undefined) {
        throw new StatusBarValidationError('Separator rows cannot have a submenu');
      }
      if (child.checked !== undefined) {
        throw new StatusBarValidationError('Separator rows cannot be checkable');
      }
      continue;
    }
    if (typeof child.id !== 'string' || child.id.trim() === '') {
      throw new StatusBarValidationError('Submenu item id must be a non-empty string');
    }
    if (child.id.includes(':')) {
      throw new StatusBarValidationError(
        `Status-bar item id '${child.id}' cannot contain ':' (reserved path separator)`,
      );
    }
    if (seenIds.has(child.id)) {
      throw new StatusBarValidationError(
        `Duplicate sibling id '${child.id}' inside submenu`,
      );
    }
    seenIds.add(child.id);

    if (Array.isArray(child.submenu)) {
      validateSiblings(child.submenu, depth + 1);
    } else if (child.submenu !== undefined) {
      throw new StatusBarValidationError(
        `submenu on item '${child.id}' must be an array when present`,
      );
    }
  }
}

export class StatusBarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusBarValidationError';
  }
}

/**
 * Strip `onClick` callbacks from the tree before IPC serialization. Returns
 * a deep copy safe to postMessage, leaving the original untouched so the
 * SDK can keep dispatching to the original handlers.
 */
export function stripHandlers(item: IStatusBarItem): IStatusBarItem {
  const { onClick: _onClick, submenu, ...rest } = item;
  const copy: IStatusBarItem = { ...rest };
  if (Array.isArray(submenu)) {
    copy.submenu = submenu.map(stripHandlers);
  }
  return copy;
}

/**
 * Walk the tree collecting `onClick` handlers keyed by their
 * `:`-joined item path. Used by the proxy to dispatch tray click events.
 */
export function collectHandlers(
  item: IStatusBarItem,
): Map<string, (ctx: { itemPath: string[]; checked?: boolean }) => void> {
  const out = new Map<
    string,
    (ctx: { itemPath: string[]; checked?: boolean }) => void
  >();
  walk(item, [], out);
  return out;
}

function walk(
  item: IStatusBarItem,
  parentPath: string[],
  out: Map<string, (ctx: { itemPath: string[]; checked?: boolean }) => void>,
): void {
  if (item.separator === true) return;
  // Non-separator items carry an id by contract (validator enforces
  // non-empty). Fallback to '' is purely for type safety here.
  const path = [...parentPath, item.id ?? ''];
  if (typeof item.onClick === 'function') {
    out.set(path.join(':'), item.onClick);
  }
  if (Array.isArray(item.submenu)) {
    for (const child of item.submenu) {
      walk(child, path, out);
    }
  }
}
