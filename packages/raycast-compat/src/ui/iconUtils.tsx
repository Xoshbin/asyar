import React from 'react';

/**
 * Renders an icon which could be an emoji, an image URL/data URI,
 * or a Raycast Image.ImageLike object ({ source: ..., tintColor?: ... }).
 */
export function renderIconElement(icon: any, defaultSize: string = '16px'): React.ReactNode {
  if (!icon) return null;

  if (typeof icon === 'string') {
    if (
      icon.startsWith('http://') ||
      icon.startsWith('https://') ||
      icon.startsWith('data:') ||
      icon.startsWith('asyar-') ||
      icon.startsWith('file://') ||
      icon.startsWith('/') ||
      /\.(png|svg|jpg|jpeg|webp|gif|ico)$/i.test(icon)
    ) {
      return (
        <img
          src={icon}
          alt=""
          style={{
            width: defaultSize,
            height: defaultSize,
            objectFit: 'contain',
            borderRadius: '4px',
            flexShrink: 0,
          }}
        />
      );
    }
    return <span style={{ fontSize: defaultSize, lineHeight: 1, flexShrink: 0 }}>{icon}</span>;
  }

  if (typeof icon === 'object') {
    const source = icon.source ?? icon.value ?? icon.path ?? '';
    const tintColor = icon.tintColor;
    const color = typeof tintColor === 'string' ? tintColor : undefined;

    if (
      typeof source === 'string' &&
      (source.startsWith('http://') ||
        source.startsWith('https://') ||
        source.startsWith('data:') ||
        source.startsWith('asyar-') ||
        source.startsWith('file://') ||
        source.startsWith('/') ||
        /\.(png|svg|jpg|jpeg|webp|gif|ico)$/i.test(source))
    ) {
      return (
        <img
          src={source}
          alt=""
          style={{
            width: defaultSize,
            height: defaultSize,
            objectFit: 'contain',
            borderRadius: '4px',
            flexShrink: 0,
            filter: color ? `drop-shadow(0 0 0 ${color})` : undefined,
          }}
        />
      );
    }
    return (
      <span style={{ fontSize: defaultSize, lineHeight: 1, color, flexShrink: 0 }}>
        {typeof source === 'string' ? source : '📦'}
      </span>
    );
  }

  return <span style={{ fontSize: defaultSize }}>{String(icon)}</span>;
}
