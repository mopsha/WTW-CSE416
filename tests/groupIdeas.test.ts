import { parseGroupIdea } from '@shared/api/groupIdeas.ts';

test('normalizes unscheduled ideas without introducing Pick or scheduling fields', () => {
  expect(
    parseGroupIdea({
      name: ' Catan ',
      category: 'activity',
      description: ' ',
      locationText: ' John’s house ',
      createdBy: 'someone-else',
    }),
  ).toEqual({
    name: 'Catan',
    category: 'activity',
    description: null,
    locationText: 'John’s house',
  });
  expect(parseGroupIdea({ name: 'Dinner', category: 'food' })).toMatchObject({
    description: null,
    locationText: null,
  });
});
test.each([
  null,
  [],
  {},
  { name: ' ', category: 'activity' },
  { name: 'Hi', category: 'custom' },
  { name: 'a'.repeat(61), category: 'food' },
  { name: 'Dinner', category: 'food', description: 'a'.repeat(201) },
  { name: 'Dinner', category: 'food', locationText: 42 },
])('rejects invalid idea %p', (body) => {
  expect(() => parseGroupIdea(body)).toThrow();
});
test('validates Unicode characters consistently with Postgres and moderates every visible field', () => {
  expect(parseGroupIdea({ name: '🎲'.repeat(60), category: 'activity' }).name).toHaveLength(120);
  for (const key of ['name', 'description', 'locationText'])
    expect(() =>
      parseGroupIdea({ name: 'Game night', category: 'activity', [key]: 'fuck' }),
    ).toThrow('isn’t allowed');
});
