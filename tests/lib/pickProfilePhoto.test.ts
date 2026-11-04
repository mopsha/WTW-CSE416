import { pickProfilePhoto } from '@/lib/pickProfilePhoto';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));
const pick = jest.mocked(ImagePicker.launchImageLibraryAsync);
const manipulate = jest.mocked(ImageManipulator.manipulate);
beforeEach(() => jest.clearAllMocks());
test('cancellation does not process an image or request broad access', async () => {
  pick.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await pickProfilePhoto()).toBeNull();
  expect(manipulate).not.toHaveBeenCalled();
  expect(pick).toHaveBeenCalledWith(
    expect.objectContaining({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      allowsMultipleSelection: false,
    }),
  );
});
test('permission failures are actionable and processing failures preserve the previous state', async () => {
  pick.mockRejectedValueOnce(
    Object.assign(new Error('Permission denied'), { code: 'E_PERMISSION_MISSING' }),
  );
  await expect(pickProfilePhoto()).rejects.toMatchObject({ permission: true });
  pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'photo.heic', width: 3000, height: 3001, type: 'image' }],
  });
  manipulate.mockReturnValueOnce({
    renderAsync: jest.fn().mockRejectedValue(new Error('decode failed')),
    release: jest.fn(),
  } as unknown as ReturnType<typeof ImageManipulator.manipulate>);
  await expect(pickProfilePhoto()).rejects.toMatchObject({ permission: false });
});
test('normalizes HEIC/native orientation using decoded dimensions and releases native resources', async () => {
  pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'photo.heic', width: 3000, height: 3001, type: 'image' }],
  });
  const decoded = { width: 1200, height: 1000, release: jest.fn() };
  const rendered = {
    saveAsync: jest.fn().mockResolvedValue({ base64: '/9j/2Q==' }),
    release: jest.fn(),
  };
  const source = { renderAsync: jest.fn().mockResolvedValue(decoded), release: jest.fn() };
  const context = {
    crop: jest.fn(),
    resize: jest.fn(),
    renderAsync: jest.fn().mockResolvedValue(rendered),
    release: jest.fn(),
  };
  manipulate
    .mockReturnValueOnce(source as unknown as ReturnType<typeof ImageManipulator.manipulate>)
    .mockReturnValueOnce(context as unknown as ReturnType<typeof ImageManipulator.manipulate>);
  const result = await pickProfilePhoto();
  expect(context.crop).toHaveBeenCalledWith({
    originX: 100,
    originY: 0,
    width: 1000,
    height: 1000,
  });
  expect(context.resize).toHaveBeenCalledWith({ width: 512, height: 512 });
  expect(rendered.saveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.82, base64: true });
  expect(result?.bytes).toEqual(new Uint8Array([255, 216, 255, 217]));
  expect(source.release).toHaveBeenCalled();
  expect(decoded.release).toHaveBeenCalled();
  expect(rendered.release).toHaveBeenCalled();
});
test('rejects oversized encoded output', async () => {
  pick.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'photo', width: 1, height: 1, type: 'image' }],
  });
  const image = {
    width: 1,
    height: 1,
    saveAsync: jest.fn().mockResolvedValue({ base64: 'A'.repeat(1400000) }),
    release: jest.fn(),
  };
  const context = {
    crop: jest.fn(),
    resize: jest.fn(),
    renderAsync: jest.fn().mockResolvedValue(image),
    release: jest.fn(),
  };
  manipulate.mockReturnValue(context as unknown as ReturnType<typeof ImageManipulator.manipulate>);
  await expect(pickProfilePhoto()).rejects.toThrow('Could not prepare');
});
