import React from 'react';
import { BirthdayField } from '@/components/BirthdayField';
import type { Birthday } from '@shared/api/birthdays.ts';
const { create, act } = jest.requireActual('react-test-renderer');
jest.mock('@/components/Button', () => ({
  Button: (p: object) => jest.requireActual('react').createElement('test-button', p),
}));
let tree: any;
const changed = jest.fn();
beforeEach(() => jest.clearAllMocks());
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
});
async function mount(value: Birthday | null = null, disabled = false) {
  await act(async () => {
    tree = create(<BirthdayField value={value} onChange={changed} disabled={disabled} />);
  });
}
const day = () =>
  tree.root
    .findAllByProps({ accessibilityLabel: 'Birthday day' })
    .find((n: any) => n.props.onChangeText);
const month = () => tree.root.findByType('test-button');
test('a blank birthday never invents month/day and no picker asks for a year', async () => {
  await mount();
  expect(changed).not.toHaveBeenCalled();
  expect(day().props.value).toBe('');
  await act(async () => month().props.onPress());
  const choice = tree.root
    .findAllByProps({ accessibilityLabel: 'February' })
    .find((n: any) => n.props.onPress);
  await act(async () => choice.props.onPress());
  expect(changed).toHaveBeenCalledWith({ month: 2, day: 0 });
  expect(JSON.stringify(tree.toJSON())).not.toMatch(
    /birthdate-full|birthdate-year|YYYY|DateTimePicker/,
  );
});
test('day editing preserves February 29 and invalid combinations remain visible for correction', async () => {
  await mount({ month: 2, day: 29 });
  expect(JSON.stringify(tree.toJSON())).toContain('February 29');
  await act(async () => day().props.onChangeText('30'));
  expect(changed).toHaveBeenCalledWith({ month: 2, day: 30 });
  await act(async () =>
    tree.update(<BirthdayField value={{ month: 2, day: 30 }} onChange={changed} />),
  );
  expect(JSON.stringify(tree.toJSON())).toContain('Choose a day from 1 to');
  await act(async () => day().props.onChangeText('29'));
  expect(changed).toHaveBeenLastCalledWith({ month: 2, day: 29 });
});
test('disabled controls reject edits while Save is pending', async () => {
  await mount({ month: 6, day: 15 }, true);
  expect(month().props.disabled).toBe(true);
  expect(day().props.editable).toBe(false);
  await act(async () => day().props.onChangeText('16'));
  expect(changed).not.toHaveBeenCalled();
});
