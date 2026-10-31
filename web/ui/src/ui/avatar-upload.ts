/**
 * Turning a picked file into the profile picture Settings > Profile uploads:
 * checked, centre-cropped to a square and re-encoded to 256x256 WebP (PNG
 * where WebP cannot be written), small enough for the avatars bucket. The
 * avatar Edge Function checks the real bytes again; these checks are so the
 * user hears what is wrong before anything is sent.
 */

export const AVATAR_PIXELS = 256;
/** The avatars bucket's limit, which the encoded image must fit. */
export const AVATAR_UPLOAD_BYTES = 256 * 1024;
/** The largest file the app will try to open. Anything bigger is refused before it is read. */
export const AVATAR_PICK_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Why a picked file cannot be used, or null when it can. */
export function avatarFileError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return 'Choose a PNG, JPEG or WebP image.';
  if (file.size > AVATAR_PICK_BYTES) return 'That image is over 5 MB. Choose a smaller one.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** Why an encoded picture cannot be uploaded, or null when it fits. */
export function encodedAvatarError(blob: Pick<Blob, 'size'>): string | null {
  return blob.size > AVATAR_UPLOAD_BYTES ? 'Even resized, that image is over 256 KB. Try a simpler picture.' : null;
}

export interface Crop {
  x: number;
  y: number;
  side: number;
}

/** The largest centred square in a width x height image. */
export function centreCrop(width: number, height: number): Crop {
  const side = Math.min(width, height);
  return { x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), side };
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Decodes the file, crops it to its centre square and re-encodes it. Throws
 * with a sentence when the browser cannot read it as an image.
 */
export async function encodeAvatar(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file could not be read as an image.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_PIXELS;
  canvas.height = AVATAR_PIXELS;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Pictures cannot be resized here.');
  const crop = centreCrop(bitmap.width, bitmap.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);
  bitmap.close();
  // A browser that cannot write WebP hands back a PNG instead.
  let blob = await toBlob(canvas, 'image/webp', 0.86);
  if (blob && blob.type === 'image/webp' && blob.size > AVATAR_UPLOAD_BYTES) blob = await toBlob(canvas, 'image/webp', 0.6);
  if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/png')) blob = await toBlob(canvas, 'image/png');
  if (!blob) throw new Error('That image could not be resized.');
  return blob;
}
