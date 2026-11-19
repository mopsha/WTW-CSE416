import { routeForNotification } from '@/lib/notify';

test('our local notifications open their url', () => {
  expect(routeForNotification({ url: '/pick/p1/results' })).toBe('/pick/p1/results');
});

test('server pushes carry only a pickId and open that Pick', () => {
  expect(routeForNotification({ pickId: 'p 1' })).toBe('/pick/p%201');
});

test.each([null, undefined, 'x', {}, { url: 'https://evil.example' }, { pickId: '' }])(
  'ignores %p',
  (data) => {
    expect(routeForNotification(data)).toBeNull();
  },
);

test('Hang push opens its specific card and legacy payloads fall back to the feed', () => {
  expect(routeForNotification({ type: 'hang_invite', hangId: 'hang/21' })).toBe('/hang/hang%2F21');
  expect(routeForNotification({ type: 'hang_invite' })).toBe('/');
});
