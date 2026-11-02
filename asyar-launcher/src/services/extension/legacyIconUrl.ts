import type { ResolvedIcon } from '../../bindings';

// COMPAT(remove in 0.2.0): `extensions:getAllExtensionsWithState` responses always carried an
// undeclared `iconUrl` string; published extensions that call it through the SDK may read it.
// Built from the resolved icon, so unsafe manifest icons (`file://`, `http://`) stay dropped.
export function legacyIconUrl(icon: ResolvedIcon | null | undefined): string | undefined {
  switch (icon?.kind) {
    case 'glyph':
      return `icon:${icon.name}`;
    case 'emoji':
      return icon.value;
    case 'image':
      return icon.src;
    case 'remote':
      return icon.url;
  }
}
