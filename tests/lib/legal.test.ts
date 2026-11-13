import { Alert, type AlertButton, Linking, Share } from 'react-native';

import { openLegalPage, PRIVACY_URL } from '@/lib/legal';

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

it('opens the page without an alert when the browser opens', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await openLegalPage(PRIVACY_URL, 'Privacy Policy');
  expect(open).toHaveBeenCalledWith(PRIVACY_URL);
  expect(alert).not.toHaveBeenCalled();
});

it('offers a retry and the link when the browser fails', async () => {
  const open = jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValueOnce(new Error('no browser'))
    .mockResolvedValueOnce(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
  await openLegalPage(PRIVACY_URL, 'Privacy Policy');

  expect(alert).toHaveBeenCalledWith(
    "Couldn't open Privacy Policy",
    expect.stringContaining(PRIVACY_URL),
    expect.any(Array),
  );
  const buttons: AlertButton[] = alert.mock.calls[0]?.[2] ?? [];
  const press = (text: string) => buttons.find((b) => b.text === text)?.onPress?.();

  press('Share link');
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: PRIVACY_URL }));

  press('Try again');
  await flush();
  expect(open).toHaveBeenCalledTimes(2);
  expect(alert).toHaveBeenCalledTimes(1);
});
