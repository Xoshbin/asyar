import type { ResolvedIcon } from '../bindings';

/**
 * An icon as callers hold it: a `ResolvedIcon` resolved in Rust
 * (`src-tauri/src/icons.rs`), or a host-internal string such as
 * `'icon:timer'`, an emoji, or a host image URL.
 */
export type IconSource = ResolvedIcon | string | null | undefined;

const IMAGE_PREFIXES = ['data:image/', 'asyar-extension://', 'asyar-icon://', 'asyar-thumb://'];

/**
 * Adapter for icon strings that never pass through the Rust resolver
 * (built-in literals, runtime actions). Same rules as `resolve_icon` with no
 * owning extension: relative paths and unknown schemes resolve to `null`.
 */
export function toResolvedIcon(icon: IconSource): ResolvedIcon | null {
  if (!icon) return null;
  if (typeof icon !== 'string') return icon;
  const raw = icon.trim();
  if (raw.startsWith('icon:')) return raw.length > 5 ? { kind: 'glyph', name: raw.slice(5) } : null;
  if (IMAGE_PREFIXES.some((p) => raw.startsWith(p))) return { kind: 'image', src: raw };
  if (raw.startsWith('https://')) return { kind: 'remote', url: raw };
  if (!raw || /[:./\\]/.test(raw)) return null;
  return { kind: 'emoji', value: raw };
}
