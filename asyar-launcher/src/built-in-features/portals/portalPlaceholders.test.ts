import { describe, it, expect } from 'vitest';
import {
  extractPortalArguments,
  isKnownPortalPlaceholder,
  tokenizePortalLink,
} from './portalPlaceholders';

describe('portalPlaceholders', () => {
  it('extracts up to 3 deduplicated arguments with defaults and options', () => {
    const args = extractPortalArguments(
      'https://example.com/?q={argument name="Search Query"}&q2={argument name="Search Query"}&tone={argument name="Tone" default="calm" options="calm, bold"}&extra={argument name="Extra"}',
    );

    expect(args).toHaveLength(3);
    // Required arguments are ordered before optional ones
    expect(args[0]).toEqual({
      name: 'Search_Query',
      type: 'text',
      placeholder: 'Search Query',
      required: true,
      default: undefined,
    });
    expect(args[1]).toEqual({
      name: 'Extra',
      type: 'text',
      placeholder: 'Extra',
      required: true,
      default: undefined,
    });
    expect(args[2]).toEqual({
      name: 'Tone',
      type: 'dropdown',
      placeholder: 'Tone',
      required: false,
      default: 'calm',
      data: [
        { title: 'calm', value: 'calm' },
        { title: 'bold', value: 'bold' },
      ],
    });
  });

  it('supports legacy {query} and {Query} placeholders', () => {
    expect(extractPortalArguments('https://t.example/?text={Query}')).toEqual([
      {
        name: 'Query',
        type: 'text',
        placeholder: 'Query',
        required: true,
        default: undefined,
      },
    ]);
  });

  it('validates known placeholders and rejects invalid format+locale combination', () => {
    expect(isKnownPortalPlaceholder('clipboard | raw')).toBe(true);
    expect(isKnownPortalPlaceholder('date format="yyyy-MM-dd" offset="+1d"')).toBe(true);
    expect(isKnownPortalPlaceholder('date format="yyyy-MM-dd" locale="fr-FR"')).toBe(false);
    expect(isKnownPortalPlaceholder('unknown_token')).toBe(false);
  });

  it('tokenizes link into literal and placeholder segments', () => {
    const segments = tokenizePortalLink('https://translate.google.com/?text={Query}&op=translate');
    expect(segments).toEqual([
      { text: 'https://translate.google.com/?text=', isPlaceholder: false, isArgument: false },
      { text: '{Query}', isPlaceholder: true, isArgument: true },
      { text: '&op=translate', isPlaceholder: false, isArgument: false },
    ]);
  });
});
