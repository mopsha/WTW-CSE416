import { normalizeForFilter, textFilter } from '@shared/domain/textFilter.ts';

const blocked = (text: string) => !textFilter(text).ok;

test.each([
  'Ava',
  'Friday boba crew',
  'Scunthorpe', // contains a blocked word inside another word
  'Classic assistant',
  'Cocktail hour',
  'Dickens Book Club',
  'Grass and glass',
  'Shiitake ramen',
  'Nigeria trip',
  'Niger river',
  'Stop sniggering',
  'A niggardly budget',
  'Go dinner',
  'Raptors game',
  '',
  '😀🍕',
  'Mañana café',
])('allows %p', (text) => {
  expect(textFilter(text)).toEqual({ ok: true });
});

test.each([
  ['a plain word', 'fuck this'],
  ['any case', 'SHIT'],
  ['punctuation around it', '...bitch!'],
  ['l33t', 'sh1t'],
  ['l33t with symbols', '$hit'],
  ['accents', 'fück'],
  ['repeated letters', 'fuuuuuck'],
  ['spaced out', 'f u c k'],
  ['dotted', 'f.u.c.k'],
  ['starred', 'c*u*n*t'],
  ['zero-width characters', 'fu\u200bck'],
  ['a slur inside a word', 'xxniggerxx'],
  ['a slur with repeats', 'niiiggggerr'],
  ['a slur in l33t', 'n1gg3r'],
  ['a slur split across words', 'nig ger'],
  ['a phrase', 'just kill yourself'],
  ['an abbreviation', 'kys'],
])('blocks %s', (_label, text) => {
  expect(textFilter(text)).toEqual({ ok: false, reason: 'blocked_word' });
});

test('normalizes case, accents and l33t, nothing else', () => {
  expect(normalizeForFilter('ÁvA 4 L1f3!')).toBe('ava a lifei');
  expect(normalizeForFilter('ÁvA 4 L1f3!', false)).toBe('ava 4 l1f3!');
});

test('never echoes the matched word', () => {
  expect(JSON.stringify(textFilter('fuck'))).not.toContain('fuck');
  expect(blocked('fuck')).toBe(true);
});
