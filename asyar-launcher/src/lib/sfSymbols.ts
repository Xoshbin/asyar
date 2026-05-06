import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

const IS_MACOS = (() => {
  try { return platform() === 'macos'; } catch { return false; }
})();

// Names listed here render as SF Symbols on macOS; anything else falls
// through to the existing Lucide SVG.
const SF_BY_NAME: Record<string, string> = {
  keyboard:           'keyboard',
  pencil:             'pencil',
  trash:              'trash',
  refresh:            'arrow.clockwise',
  scissors:           'scissors',
  plus:               'plus',
  tag:                'tag',
  sparkles:           'sparkles',
  history:            'clock.arrow.trianglehead.counterclockwise.rotate.90',
  'arrow-up-circle':  'arrow.up.circle.fill',
  download:           'square.and.arrow.down',
  settings:           'gear',
  copy:               'doc.on.doc',
  link:               'link',
  power:              'power',
  star:               'star',
  pin:                'pin',
  user:               'person.crop.circle',
  info:               'info.circle',
  globe:              'globe',
  clipboard:          'clipboard',
  layers:             'square.stack.3d.up',
  filter:             'line.3.horizontal.decrease.circle',
  image:              'photo',
  type:               'textformat',
  'file-text':        'doc.text',
  eye:                'eye',
  store:              'bag.fill',
  puzzle:             'puzzlepiece.extension.fill',
  'cloud-upload':     'icloud.and.arrow.up',
  palette:            'paintpalette',
  'ai-chat':          'sparkles',
  snippets:           'chevron.left.forwardslash.chevron.right',
  calculator:         'function',
};

interface SymbolMaskRaw {
  png_b64: string;
  width: number;
  height: number;
}

export interface SymbolMask {
  url: string;
  width: number;
  height: number;
}

const MASK_CACHE = new Map<string, Promise<SymbolMask | null>>();

function cacheKey(symbol: string, size: number): string {
  return `${symbol}|${Math.round(size)}`;
}

export function sfSymbolFor(name: string): string | null {
  if (!IS_MACOS) return null;
  return SF_BY_NAME[name] ?? null;
}

export async function sfSymbolMask(name: string, size: number): Promise<SymbolMask | null> {
  const symbol = sfSymbolFor(name);
  if (!symbol) return null;

  const key = cacheKey(symbol, size);
  const existing = MASK_CACHE.get(key);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const raw = await invoke<SymbolMaskRaw>('render_sf_symbol_mask', {
        name: symbol,
        size,
        weight: 'regular',
      });
      return {
        url: `data:image/png;base64,${raw.png_b64}`,
        width: raw.width,
        height: raw.height,
      };
    } catch {
      return null;
    }
  })();

  MASK_CACHE.set(key, pending);
  return pending;
}
