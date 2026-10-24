// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MetadataList from './MetadataList.svelte';

describe('MetadataList', () => {
  it('renders nothing when items are empty', () => {
    const { container } = render(MetadataList, {
      items: [],
    });
    expect(container.querySelector('.metadata-section')).toBeNull();
  });

  it('renders nothing when all item values are null, undefined, or empty', () => {
    const { container } = render(MetadataList, {
      items: [
        { label: 'Size', value: null },
        { label: 'Path', value: undefined },
        { label: 'Name', value: '' },
      ],
    });
    expect(container.querySelector('.metadata-section')).toBeNull();
  });

  it('filters out empty values and renders only visible items', () => {
    render(MetadataList, {
      items: [
        { label: 'Name', value: 'models.rs' },
        { label: 'Size', value: null },
        { label: 'Kind', value: 'Rust Source' },
      ],
    });

    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('models.rs')).toBeTruthy();
    expect(screen.queryByText('Size')).toBeNull();
    expect(screen.getByText('Kind')).toBeTruthy();
    expect(screen.getByText('Rust Source')).toBeTruthy();
  });

  it('renders title when title prop is provided', () => {
    render(MetadataList, {
      title: 'Information',
      items: [{ label: 'Name', value: 'test.txt' }],
    });

    expect(screen.getByText('Information')).toBeTruthy();
  });

  it('does not render header element when title is omitted', () => {
    const { container } = render(MetadataList, {
      items: [{ label: 'Name', value: 'test.txt' }],
    });

    expect(container.querySelector('.metadata-header')).toBeNull();
  });

  it('applies striped class to alternating rows (0, 2, etc.)', () => {
    const { container } = render(MetadataList, {
      items: [
        { label: 'Row 0', value: 'Val 0' },
        { label: 'Row 1', value: 'Val 1' },
        { label: 'Row 2', value: 'Val 2' },
        { label: 'Row 3', value: 'Val 3' },
      ],
    });

    const rows = container.querySelectorAll('.metadata-row');
    expect(rows.length).toBe(4);
    expect(rows[0].classList.contains('striped')).toBe(true);
    expect(rows[1].classList.contains('striped')).toBe(false);
    expect(rows[2].classList.contains('striped')).toBe(true);
    expect(rows[3].classList.contains('striped')).toBe(false);
  });

  it('renders icon when item.icon is provided', () => {
    const { container } = render(MetadataList, {
      items: [{ label: 'Source', value: 'Paseo', icon: 'data:image/png;base64,123' }],
    });

    const img = container.querySelector('.metadata-icon') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain('data:image/png;base64,123');
  });

  it('applies mono class when item.mono is true', () => {
    const { container } = render(MetadataList, {
      items: [{ label: 'Path', value: '/usr/bin/bash', mono: true }],
    });

    const dd = container.querySelector('dd');
    expect(dd?.classList.contains('mono')).toBe(true);
  });

  it('uses custom title tooltip if provided, otherwise uses value', () => {
    render(MetadataList, {
      items: [
        { label: 'Where', value: '~/develop', title: '/Users/test/develop' },
        { label: 'Type', value: 'File' },
      ],
    });

    const ddWhere = screen.getByText('~/develop').closest('dd');
    expect(ddWhere?.getAttribute('title')).toBe('/Users/test/develop');

    const ddType = screen.getByText('File').closest('dd');
    expect(ddType?.getAttribute('title')).toBe('File');
  });
});
