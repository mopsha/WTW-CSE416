import { AVATAR_COLORS, colorForName, initialsFor } from '@/lib/avatar';

describe('initialsFor', () => {
  test.each([
    ['Mike Opsha', 'MO'],
    ['razin', 'R'],
    ['  alan   john  ', 'AJ'],
    ['Mary Ann Smith', 'MS'],
    ['', '?'],
    ['   ', '?'],
  ])('%p -> %p', (name, expected) => {
    expect(initialsFor(name)).toBe(expected);
  });
});

describe('colorForName', () => {
  test('is stable for the same name (case and spacing ignored)', () => {
    expect(colorForName('Josh')).toBe(colorForName('  josh '));
  });

  test('always returns a palette color', () => {
    for (const name of ['Mike', 'Josh', 'Alan', 'Razin', '', 'Zoë']) {
      expect(AVATAR_COLORS).toContain(colorForName(name));
    }
  });

  test('spreads names across the palette', () => {
    const used = new Set(['Mike', 'Josh', 'Alan', 'Razin', 'Ava', 'Ben', 'Cam'].map(colorForName));
    expect(used.size).toBeGreaterThan(2);
  });
});
