const mockPicker = { pickPhone: jest.fn(), composeText: jest.fn(), cancel: jest.fn() };
const mockNativeModule = jest.fn();
const mockShare = jest.fn();
let mockPlatform = 'ios';

jest.mock('expo', () => ({
  requireOptionalNativeModule: (name: string) => mockNativeModule(name),
}));
jest.mock('react-native', () =>
  Object.create(jest.requireActual('react-native'), {
    Platform: {
      value: {
        get OS() {
          return mockPlatform;
        },
      },
    },
    Share: { value: { share: (content: unknown) => mockShare(content) } },
  }),
);

function load(platform = 'ios', available = true) {
  mockPlatform = platform;
  mockNativeModule.mockReturnValue(available ? mockPicker : null);
  let lib!: typeof import('@/lib/contactInvites');
  jest.isolateModules(() => {
    lib = jest.requireActual<typeof import('@/lib/contactInvites')>('@/lib/contactInvites');
  });
  return lib;
}

beforeAll(() => {
  // Initialize the Expo preset's lazy fetch before Jest tears down the isolated registry.
  void globalThis.fetch;
});
beforeEach(() => {
  jest.resetAllMocks();
  mockPicker.cancel.mockResolvedValue(undefined);
});

test.each([
  ['ios', 'closed'],
  ['android', 'opened'],
])('%s hands one chosen number to its messaging UI', async (platform, result) => {
  const { createContactRequest } = load(platform);
  mockPicker.pickPhone.mockResolvedValue({ status: 'selected', number: '+1 (202) 555-0123' });
  mockPicker.composeText.mockResolvedValue(result);
  expect(await createContactRequest().run('previewed draft')).toBeUndefined();
  expect(mockPicker.composeText).toHaveBeenCalledTimes(1);
  expect(mockPicker.composeText).toHaveBeenCalledWith(
    expect.any(Number),
    '+12025550123',
    'previewed draft',
  );
  expect(mockShare).not.toHaveBeenCalled();
});

test.each([
  [{ status: 'cancelled' }, undefined],
  [{ status: 'denied' }, 'denied'],
  [{ status: 'noPhone' }, 'noPhone'],
  [{ status: 'selected', number: '' }, 'noPhone'],
  [{ status: 'selected', number: '2025550123,2025550123' }, 'noPhone'],
  [{ status: 'unavailable' }, 'pickerUnavailable'],
])('handles picker result %j without opening a draft', async (selection, issue) => {
  const { createContactRequest } = load();
  mockPicker.pickPhone.mockResolvedValue(selection);
  expect(await createContactRequest().run('previewed draft')).toBe(issue);
  expect(mockPicker.composeText).not.toHaveBeenCalled();
  expect(mockShare).not.toHaveBeenCalled();
});

test('ignores a selection returned after the account changes or the flow closes', async () => {
  const { createContactRequest } = load();
  let select!: (result: unknown) => void;
  mockPicker.pickPhone.mockReturnValue(new Promise((resolve) => (select = resolve)));
  const first = createContactRequest();
  const pending = first.run('old account preview');
  first.cancel();
  expect(mockPicker.cancel).toHaveBeenCalledWith(mockPicker.pickPhone.mock.calls[0]?.[0]);
  select({ status: 'selected', number: '2025550123' });
  expect(await pending).toBeUndefined();
  expect(mockPicker.composeText).not.toHaveBeenCalled();
});

test('SMS cancellation is silent and an unavailable composer requires a separate share tap', async () => {
  const { createContactRequest } = load();
  mockPicker.pickPhone.mockResolvedValue({ status: 'selected', number: '2025550123' });
  mockPicker.composeText.mockResolvedValueOnce('cancelled').mockResolvedValueOnce('unavailable');
  expect(await createContactRequest().run('draft')).toBeUndefined();
  expect(await createContactRequest().run('draft')).toBe('textUnavailable');
  expect(mockShare).not.toHaveBeenCalled();
});

test('native errors are reduced to status codes without leaking contact details', async () => {
  const { createContactRequest, shareInvite } = load();
  mockPicker.pickPhone.mockRejectedValueOnce(new Error('private details'));
  expect(await createContactRequest().run('draft')).toBe('pickerUnavailable');
  mockPicker.pickPhone.mockResolvedValue({ status: 'selected', number: '2025550123' });
  mockPicker.composeText.mockRejectedValue(new Error('private details'));
  expect(await createContactRequest().run('draft')).toBe('textUnavailable');
  mockShare.mockRejectedValue(new Error('unavailable'));
  expect(await shareInvite('draft')).toBe(false);
});

test.each([
  ['ios', 'dismissedAction'],
  ['android', 'sharedAction'],
])('%s share sheet dismissal needs no follow-up', async (platform, action) => {
  const { shareInvite } = load(platform);
  mockShare.mockResolvedValue({ action });
  expect(await shareInvite('draft')).toBe(true);
  expect(mockShare).toHaveBeenCalledTimes(1);
  expect(mockShare).toHaveBeenCalledWith({ message: 'draft' });
  expect(mockPicker.pickPhone).not.toHaveBeenCalled();
});

test('web keeps the copy fallback and older native builds keep the share sheet', async () => {
  const web = load('web');
  expect(web.contactPickerAvailable).toBe(false);
  expect(await web.shareInvite('draft')).toBe(false);
  expect(mockNativeModule).not.toHaveBeenCalled();
  const olderBuild = load('android', false);
  expect(olderBuild.contactPickerAvailable).toBe(false);
  expect(await olderBuild.shareInvite('draft')).toBe(true);
});

test('a dismissed picker can be reopened without a stale cancellation affecting the new request', async () => {
  const { createContactRequest } = load();
  mockPicker.pickPhone
    .mockResolvedValueOnce({ status: 'cancelled' })
    .mockResolvedValueOnce({ status: 'selected', number: '2025550123' });
  mockPicker.composeText.mockResolvedValue('closed');
  const first = createContactRequest();
  expect(await first.run('draft')).toBeUndefined();
  const second = createContactRequest();
  const opening = second.run('new draft');
  first.cancel();
  expect(await opening).toBeUndefined();
  const firstId = mockPicker.pickPhone.mock.calls[0]?.[0];
  const secondId = mockPicker.pickPhone.mock.calls[1]?.[0];
  expect(firstId).not.toBe(secondId);
  expect(mockPicker.cancel).toHaveBeenCalledWith(firstId);
  expect(mockPicker.composeText).toHaveBeenCalledWith(secondId, '2025550123', 'new draft');
});

test('a configured HTTPS destination accompanies the public username and installed-app link', () => {
  const { contactInvitation } = load();
  expect(contactInvitation('alex', ' https://apps.apple.com/ ')).toEqual({
    installedOnly: false,
    message: 'Find me as @alex on WTW!\nGet WTW: https://apps.apple.com/\nOpen WTW: wtw://friends',
  });
});

test.each([
  '',
  'bad-url',
  'http://example.com',
  'https:///example.com/install',
  'https://user:secret@example.com/install',
  'https://localhost/install',
  'https://127.0.0.1/install',
  'https://[::1]/install',
  'https://install.wtw.local',
  'https://example.com/install',
])('uses explicit installed-only text when the install destination is %p', (url) => {
  const { contactInvitation } = load();
  expect(contactInvitation('person@example.com', url)).toEqual({
    installedOnly: true,
    message:
      'Find friends on WTW!\nFor people who already have WTW installed.\nOpen WTW: wtw://friends',
  });
});
