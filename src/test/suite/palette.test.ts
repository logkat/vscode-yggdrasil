import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Every background a tree row's label can be composited against, per theme key.
 * Sources: sideBar.background (registry + Modern theme overrides),
 * list.hoverBackground, list.inactiveSelectionBackground. Active selection is
 * excluded for dark/light because list.activeSelectionForeground overrides us.
 */
const BACKGROUNDS: Record<string, string[]> = {
  dark: ['#252526', '#181818', '#2A2D2E', '#37373D'],
  light: ['#F3F3F3', '#F8F8F8', '#F0F0F0', '#E4E6F1'],
  highContrast: ['#000000', '#1a1a1a'],
  highContrastLight: ['#ffffff', '#e7edf3'],
};

/**
 * Values are built to 5.0:1. Asserting 5.0 is too tight for values that land at
 * exactly 5.00 once rounding is involved; asserting the 4.5 legal minimum would
 * let a future edit drift to 4.51 and stay green. 4.9 catches real drift.
 */
const THRESHOLD = 4.9;

/** WCAG 2.1 relative luminance for a `#rrggbb` string. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two `#rrggbb` strings. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

suite('contributed colors — WCAG AA on every row background', () => {
  // Tests run from out/test/suite/, so package.json is three levels up.
  const manifestPath = path.join(__dirname, '..', '..', '..', 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const colors: { id: string; defaults: Record<string, string> }[] = manifest.contributes.colors;

  test('the helper reproduces a known WCAG ratio', () => {
    assert.strictEqual(Math.round(contrast('#ffffff', '#000000')), 21);
  });

  for (const color of colors) {
    for (const [key, backgrounds] of Object.entries(BACKGROUNDS)) {
      test(`${color.id} ${key} is legible on every row background`, () => {
        const value = color.defaults[key];
        assert.ok(value, `${color.id} is missing a ${key} value`);

        for (const background of backgrounds) {
          const ratio = contrast(value, background);
          assert.ok(
            ratio >= THRESHOLD,
            `${color.id}.${key} ${value} on ${background} scored ${ratio.toFixed(2)}`
          );
        }
      });
    }
  }
});
