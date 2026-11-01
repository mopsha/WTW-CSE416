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
