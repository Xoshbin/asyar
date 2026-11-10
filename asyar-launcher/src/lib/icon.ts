import type { ResolvedIcon } from '../bindings';
import { getHostPlatform, type HostPlatform } from './keyboard/hostPlatform';

/**
 * An icon as callers hold it: a `ResolvedIcon` resolved in Rust
 * (`src-tauri/src/icons.rs`), or a host-internal string such as
 * `'icon:timer'`, an emoji, or a host image URL.
 */
export type IconSource = ResolvedIcon | string | null | undefined;

const HOST_SCHEMES = ['asyar-extension', 'asyar-icon', 'asyar-thumb'] as const;

/**
 * Normalizes a host scheme or data image URL for the current webview.
 * On Windows, WebView2 loads custom schemes from `http://<scheme>.localhost/`;
 * on macOS and Linux, `http://asyar-*.localhost/` URLs are rejected so plain
 * HTTP loopback URLs can never reach an `<img>`.
 */
export function normalizeHostImageUrl(
  raw: string,
  platform: HostPlatform = getHostPlatform(),
): string | null {
  if (raw.startsWith('data:image/')) return raw;

  const isWindows = platform === 'windows';
  for (const scheme of HOST_SCHEMES) {
    const localhostPrefix = `${scheme}://localhost/`;
    const barePrefix = `${scheme}://`;
    const windowsPrefix = `http://${scheme}.localhost/`;

    if (raw.startsWith(localhostPrefix)) {
      const rest = raw.slice(localhostPrefix.length);
      if (!rest) return null;
      return isWindows ? `${windowsPrefix}${rest}` : raw;
    }
    if (raw.startsWith(barePrefix)) {
      const rest = raw.slice(barePrefix.length);
      if (!rest) return null;
      return isWindows ? `${windowsPrefix}${rest}` : raw;
    }
    if (isWindows && raw.startsWith(windowsPrefix)) {
      return raw.length > windowsPrefix.length ? raw : null;
    }
  }

  return null;
}

/**
 * Adapter for icon strings that never pass through the Rust resolver
 * (built-in literals, runtime actions). Same rules as `resolve_icon` with no
 * owning extension: relative paths and unknown schemes resolve to `null`.
 */
export function toResolvedIcon(
  icon: IconSource,
  platform: HostPlatform = getHostPlatform(),
): ResolvedIcon | null {
  if (!icon) return null;
  if (typeof icon !== 'string') {
    if (icon.kind !== 'image') return icon;
    const src = normalizeHostImageUrl(icon.src, platform);
    if (!src) return null;
    const dark = icon.dark ? normalizeHostImageUrl(icon.dark, platform) : null;
    if (src === icon.src && (dark ?? undefined) === (icon.dark ?? undefined)) return icon;
    return {
      ...icon,
      src,
      ...(icon.dark !== undefined ? { dark } : {}),
    };
  }
  const raw = icon.trim();
  if (raw.startsWith('icon:')) return raw.length > 5 ? { kind: 'glyph', name: raw.slice(5) } : null;
  const hostImage = normalizeHostImageUrl(raw, platform);
  if (hostImage) return { kind: 'image', src: hostImage };
  if (raw.startsWith('https://')) return { kind: 'remote', url: raw };
  if (!raw || /[:./\\]/.test(raw)) return null;
  return { kind: 'emoji', value: raw };
}
