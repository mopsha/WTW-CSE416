import React from 'react';
import { Screen } from '@/components/Screen';
import { router } from 'expo-router';
const { create, act } = jest.requireActual<{
  create(e: React.ReactElement): {
    root: { findAllByProps(p: object): { props: { onPress(): void } }[] };
    unmount(): void;
  };
  act(work: () => void | Promise<void>): Promise<void>;
}>('react-test-renderer');
jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));
test.each([true, false])(
  'shared Back safely handles an existing/cold-start stack: %p',
  async (canGoBack) => {
    jest.clearAllMocks();
    jest.mocked(router.canGoBack).mockReturnValue(canGoBack);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(
        <Screen back>
          <></>
        </Screen>,
      );
    });
    await act(async () =>
      tree.root.findAllByProps({ accessibilityLabel: 'Back' })[0]!.props.onPress(),
    );
    if (canGoBack) {
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.replace).not.toHaveBeenCalled();
    } else {
      expect(router.back).not.toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith('/');
    }
    await act(async () => tree.unmount());
  },
);
