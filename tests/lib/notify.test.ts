import { notificationTap, routeForNotification } from '@/lib/notify';

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

test('push taps pair the Requests route with the exact inbox row, and ignore malformed IDs', () => {
  const notificationId = '00000000-0000-4000-8000-000000000001';
  expect(notificationTap({ type: 'group_invite', notificationId })).toEqual({
    route: '/friends?requests=1',
    notificationId,
  });
  expect(notificationTap({ pickId: 'pick', notificationId: 'not-an-id' })).toEqual({
    route: '/pick/pick',
  });
});
