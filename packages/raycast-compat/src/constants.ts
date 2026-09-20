export enum Color {
  Blue = '#3b82f6',
  Green = '#10b981',
  Magenta = '#ec4899',
  Orange = '#f97316',
  Purple = '#8b5cf6',
  Red = '#ef4444',
  Yellow = '#eab308',
  PrimaryText = 'var(--text-primary, #ffffff)',
  SecondaryText = 'var(--text-secondary, #94a3b8)',
}

export enum Icon {
  Check = '✓',
  Checkmark = '✓',
  XMark = '✕',
  Multiply = '✕',
  Trash = '🗑️',
  Gear = '⚙️',
  MagnifyingGlass = '🔍',
  CopyDocument = '📋',
  Folder = '📁',
  Document = '📄',
  Link = '🔗',
  Globe = '🌐',
  Star = '⭐',
  Terminal = '💻',
  Download = '⬇️',
  Upload = '⬆️',
  Play = '▶️',
  Pause = '⏸️',
  Clock = '🕒',
  Calendar = '📅',
  Person = '👤',
  Plus = '➕',
  Minus = '➖',
  Eye = '👁️',
  EyeSlash = '🙈',
  Bell = '🔔',
  Warning = '⚠️',
  Info = 'ℹ️',
  QuestionMark = '❓',
  ArrowUp = '↑',
  ArrowDown = '↓',
  ArrowLeft = '←',
  ArrowRight = '→',
  ChevronUp = '▲',
  ChevronDown = '▼',
  ChevronLeft = '◀',
  ChevronRight = '▶',
  Circle = '●',
  Dot = '•',
  Code = '</>',
  CodeBlock = '💻',
  QuestionMarkCircle = '❓',
}

export namespace Keyboard {
  export type KeyModifier = 'cmd' | 'ctrl' | 'shift' | 'opt';

  export interface Shortcut {
    modifiers: KeyModifier[];
    key: string;
  }
}

export namespace Image {
  export enum Mask {
    Circle = 'circle',
    RoundedRectangle = 'rounded-rectangle',
  }

  export type Asset = {
    light: string;
    dark: string;
  };

  export type ImageLike =
    | string
    | {
        source: string | Asset;
        mask?: Mask;
        fallback?: string;
      };
}
