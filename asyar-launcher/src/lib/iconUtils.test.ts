import { describe, expect, it } from 'vitest';
import { isIconImage } from './iconUtils';

describe('isIconImage', () => {
  it('treats an asyar-thumb URL as an image icon', () => {
    expect(isIconImage('asyar-thumb://localhost/native.png')).toBe(true);
  });
});
