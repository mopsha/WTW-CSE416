import React from 'react';
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { PlanTimeSheet } from '@/components/PlanTimeSheet';
const { act, create } = jest.requireActual('react-test-renderer');
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: (props: object) => jest.requireActual('react').createElement('native-picker', props),
  DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn().mockResolvedValue(true) },
}));
jest.mock('@/components/Button', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('kit-button', p),
}));
jest.mock('@/components/TabUi', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => children,
}));
const initial = new Date(2026, 10, 12, 18, 30).toISOString();
const originalOS = Platform.OS;
let tree: any;
const onSave = jest.fn();
const onClose = jest.fn();
const button = (label: string) =>
  tree.root.findAllByType('kit-button').find((n: any) => n.props.label === label);
async function press(label: string) {
  await act(async () => button(label).props.onPress());
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 10, 11, 12));
  jest.clearAllMocks();
  onSave.mockResolvedValue(undefined);
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  await act(async () => {
    tree = create(<PlanTimeSheet initial={initial} onSave={onSave} onClose={onClose} />);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS });
  jest.useRealTimers();
});
test('preset and cancel leave the saved plan untouched', async () => {
  await press('In 1 hour');
  expect(onSave).not.toHaveBeenCalled();
  await press('Cancel');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
test('save persists the chosen preset then closes', async () => {
  await press('Tomorrow at 7 PM');
  await press('Save time');
  expect(onSave).toHaveBeenCalledWith(new Date(2026, 10, 12, 19).toISOString());
  expect(onClose).toHaveBeenCalledTimes(1);
});
test('failed save retains the draft for retry', async () => {
  onSave.mockRejectedValueOnce(new Error('Offline'));
  await press('Tomorrow at 7 PM');
  await press('Save time');
  expect(onClose).not.toHaveBeenCalled();
  expect(JSON.stringify(tree.toJSON())).toContain('Offline');
  await press('Save time');
  expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
});
test('same-tick duplicate saves are ignored and cancel waits for save', async () => {
  let resolve!: () => void;
  onSave.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  await act(async () => {
    button('Save time').props.onPress();
    button('Save time').props.onPress();
  });
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(button('Cancel').props.disabled).toBe(true);
  await act(async () => resolve());
});
test('iOS uses native date selection and spinner time selection', async () => {
  await press('Choose date');
  let picker = tree.root.findByType('native-picker');
  expect(picker.props.display).toBe('inline');
  await act(async () => picker.props.onValueChange({}, new Date(2026, 10, 14)));
  await press('Choose time');
  picker = tree.root.findByType('native-picker');
  expect(picker.props.display).toBe('spinner');
  await act(async () => picker.props.onValueChange({}, new Date(2026, 10, 11, 21, 15)));
  await press('Save time');
  expect(onSave).toHaveBeenCalledWith(new Date(2026, 10, 14, 21, 15).toISOString());
});
test('Android opens native dialogs and preserves fields', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  await press('Choose date');
  const props = jest.mocked(DateTimePickerAndroid.open).mock.calls[0]![0];
  expect(props.mode).toBe('date');
  await act(async () => props.onValueChange!({} as never, new Date(2026, 10, 15)));
  await press('Save time');
  expect(onSave).toHaveBeenCalledWith(new Date(2026, 10, 15, 18, 30).toISOString());
});
test('past custom selection cannot save', async () => {
  await press('Choose date');
  await act(async () =>
    tree.root.findByType('native-picker').props.onValueChange({}, new Date(2026, 9, 1)),
  );
  expect(button('Save time').props.disabled).toBe(true);
  await press('Save time');
  expect(onSave).not.toHaveBeenCalled();
});
