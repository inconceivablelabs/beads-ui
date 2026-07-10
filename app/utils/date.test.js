import { describe, expect, test } from 'vitest';
import { formatDateIso, formatDateYmd } from './date.js';

describe('utils/date formatDateYmd', () => {
  test('formats a noon-UTC epoch as local yyyy-mm-dd', () => {
    expect(formatDateYmd(Date.UTC(2026, 6, 10, 12))).toBe('2026-07-10');
  });

  test('handles a year boundary', () => {
    expect(formatDateYmd(Date.UTC(2025, 11, 12, 12))).toBe('2025-12-12');
  });

  test('returns empty string for invalid inputs', () => {
    expect(formatDateYmd(undefined)).toBe('');
    expect(formatDateYmd(0)).toBe('');
    expect(formatDateYmd(-1)).toBe('');
    expect(formatDateYmd(NaN)).toBe('');
    expect(formatDateYmd(/** @type {any} */ ('2026-07-10'))).toBe('');
  });
});

describe('utils/date formatDateIso', () => {
  test('returns a full ISO string ending in Z', () => {
    const iso = formatDateIso(Date.UTC(2026, 6, 10, 12));
    expect(typeof iso).toBe('string');
    expect(iso.endsWith('Z')).toBe(true);
  });

  test('returns empty string for invalid inputs', () => {
    expect(formatDateIso(undefined)).toBe('');
    expect(formatDateIso(0)).toBe('');
    expect(formatDateIso(NaN)).toBe('');
  });
});
