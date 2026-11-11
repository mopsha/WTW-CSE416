import jpeg from 'jpeg-js';
import { ApiError } from '../_shared/api/errors.ts';
import { AVATAR_MAX_BYTES } from '../_shared/api/avatars.ts';

/** Pure JS, no native/WASM loader. Decode then encode only pixels: no EXIF,
 * comments, GPS, appended payloads, or client-supplied metadata survives. */
export function normalizeAvatar(bytes: Uint8Array): Uint8Array {
  if (!bytes.length || bytes.length > AVATAR_MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new ApiError(400, 'INVALID_IMAGE', 'Invalid JPEG photo');
  try {
    const image = jpeg.decode(bytes, {
      useTArray: true,
      tolerantDecoding: false,
      maxResolutionInMP: 0.263,
      maxMemoryUsageInMB: 16,
    });
    if (image.width !== image.height || image.width < 1 || image.width > 512)
      throw new Error('Expected square image up to 512 pixels');
    // Do not pass decoder metadata to the encoder.
    const result = jpeg.encode(
      { width: image.width, height: image.height, data: image.data },
      85,
    ).data;
    if (result.length > AVATAR_MAX_BYTES) throw new Error('Encoded image too large');
    return new Uint8Array(result);
  } catch {
    throw new ApiError(400, 'INVALID_IMAGE', 'Expected a valid square JPEG up to 512 pixels');
  }
}
