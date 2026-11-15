import React from 'react';
import IntroScreen from '../../app/intro';

// Real kit components (PageDots, Illustration, Screen) so the dots' accessibility label is
// the one users hear.
type Node = { type: unknown; props: Record<string, any> };
type Tree = {
  root: { findAll(test: (n: Node) => boolean): Node[] };
  unmount(): void;
};
const { create, act } = jest.requireActual<{
  create(element: React.ReactElement): Tree;
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), canGoBack: () => false } }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn() } }));
jest.mock('@/lib/intro', () => ({ markIntroSeen: jest.fn() }));
jest.mock('@/lib/legal', () => ({ openLegalPage: jest.fn(), PRIVACY_URL: 'p', TERMS_URL: 't' }));

const WIDTH = 335;
let tree: Tree;
const dots = () =>
  tree.root.findAll(
    (n) =>
      typeof n.props.accessibilityLabel === 'string' &&
      /^Page \d of 3$/.test(n.props.accessibilityLabel) &&
      n.props.accessible,
  )[0]!;
const pager = () =>
  tree.root.findAll(
    (n) => n.props.horizontal === true && typeof n.props.onScroll === 'function',
  )[0]!;
async function scrollTo(x: number) {
  await act(async () => pager().props.onScroll({ nativeEvent: { contentOffset: { x, y: 0 } } }));
}

beforeEach(async () => {
  await act(async () => {
    tree = create(<IntroScreen />);
  });
  const wrapper = tree.root.findAll(
    (n) => n.props.testID === 'intro-pager' && !!n.props.onLayout,
  )[0]!;
  await act(async () =>
    wrapper.props.onLayout({ nativeEvent: { layout: { width: WIDTH, height: 400, x: 0, y: 0 } } }),
  );
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

test('the active dot and its label follow swipes, including mid-scroll updates', async () => {
  expect(dots().props.accessibilityLabel).toBe('Page 1 of 3');
  await scrollTo(WIDTH);
  expect(dots().props.accessibilityLabel).toBe('Page 2 of 3');
  await scrollTo(WIDTH * 2);
  expect(dots().props.accessibilityLabel).toBe('Page 3 of 3');
  // Past the halfway point of a swipe already counts as the next page.
  await scrollTo(WIDTH * 0.6);
  expect(dots().props.accessibilityLabel).toBe('Page 2 of 3');
  await scrollTo(0);
  expect(dots().props.accessibilityLabel).toBe('Page 1 of 3');
});

test('screen-reader page changes scroll the pager and update the label', async () => {
  const scroll = jest.fn();
  (pager() as unknown as { instance: { scrollTo: jest.Mock } }).instance.scrollTo = scroll;
  await act(async () =>
    dots().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }),
  );
  expect(dots().props.accessibilityLabel).toBe('Page 2 of 3');
  expect(scroll).toHaveBeenLastCalledWith({ x: WIDTH, animated: true });
  await act(async () =>
    dots().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }),
  );
  expect(dots().props.accessibilityLabel).toBe('Page 1 of 3');
});

test('slides use the measured pager width, not the window width', async () => {
  const slides = tree.root.findAll(
    (n) =>
      typeof n.props.testID === 'string' &&
      n.props.testID.startsWith('intro-slide-') &&
      typeof n.type === 'string',
  );
  expect(slides).toHaveLength(3);
  for (const slide of slides) {
    const style = [slide.props.style].flat(Infinity).reduce((a, b) => ({ ...a, ...b }), {});
    expect(style.width).toBe(WIDTH);
  }
});
