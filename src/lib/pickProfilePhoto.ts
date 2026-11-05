import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { AVATAR_MAX_BYTES } from '@shared/api/avatars.ts';
import { photoBytes } from './photoBytes';

export interface SelectedPhoto {
  bytes: Uint8Array;
  previewUri: string;
}
export class PhotoSelectionError extends Error {
  constructor(
    readonly permission: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** Native picker/cropper owns selection and orientation. Decode the cropped
 * asset before using dimensions, then normalize to an exact square JPEG. */
export async function pickProfilePhoto(): Promise<SelectedPhoto | null> {
  let selection: ImagePicker.ImagePickerResult;
  try {
    // The system image picker doesn't need broad library access. If the OS
    // requires permission for editing it handles that prompt; denial is surfaced.
    selection = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      exif: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (/permission|denied|access/i.test(`${code} ${message}`))
      throw new PhotoSelectionError(
        true,
        'Photo access is unavailable. Allow access in Settings and try again.',
      );
    throw new PhotoSelectionError(false, 'Could not open your photos. Please try again.');
  }
  if (selection.canceled) return null;
  const asset = selection.assets[0];
  if (!asset || asset.type === 'video') throw new PhotoSelectionError(false, 'Choose a photo.');
  let source: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let decoded:
    Awaited<ReturnType<ReturnType<typeof ImageManipulator.manipulate>['renderAsync']>> | undefined;
  let context: ReturnType<typeof ImageManipulator.manipulate> | undefined;
  let rendered: typeof decoded;
  try {
    source = ImageManipulator.manipulate(asset.uri);
    decoded = await source.renderAsync();
    if (!decoded.width || !decoded.height) throw new Error('Invalid image dimensions');
    const side = Math.min(decoded.width, decoded.height);
    context = ImageManipulator.manipulate(decoded);
    context.crop({
      originX: Math.floor((decoded.width - side) / 2),
      originY: Math.floor((decoded.height - side) / 2),
      width: side,
      height: side,
    });
    context.resize({ width: Math.min(512, side), height: Math.min(512, side) });
    rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.82,
      base64: true,
    });
    if (!saved.base64) throw new Error('No encoded image');
    const bytes = photoBytes(saved.base64);
    if (!bytes.length || bytes.length > AVATAR_MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216)
      throw new Error('Invalid or oversized image');
    return { bytes, previewUri: `data:image/jpeg;base64,${saved.base64}` };
  } catch {
    throw new PhotoSelectionError(
      false,
      'Could not prepare this photo. Choose another image and try again.',
    );
  } finally {
    rendered?.release();
    context?.release();
    decoded?.release();
    source?.release();
  }
}
