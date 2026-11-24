/**
 * Uploaded images (profile photos, GCash QR codes, payment receipts).
 *
 * Files are saved under backend/media/<folder>/ and served at /media/...
 * Only real images are accepted (checked from the file's contents, not its
 * name), and the saved file always gets the extension of its actual type, so
 * an upload can never be served back as HTML or a script.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SIGNATURES = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
  ['bmp', (b) => b.subarray(0, 2).toString('latin1') === 'BM'],
];

export const INVALID_IMAGE = 'Upload a valid image. The file you uploaded was either not an image or a corrupted image.';

/** The image type of an uploaded file ('png', 'jpg', ...), or null if it isn't an image. */
export function imageType(file) {
  const buffer = file?.buffer;
  if (!buffer || buffer.length < 12) return null;
  return SIGNATURES.find(([, test]) => test(buffer))?.[0] || null;
}

/** Save an uploaded image into `folder`; returns its path relative to the media folder. */
export async function saveImage(mediaDir, folder, file) {
  const type = imageType(file);
  const base = path.parse(file.originalname || 'image').name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'image';
  const name = `${base}_${randomBytes(4).toString('hex')}.${type}`;
  await mkdir(path.join(mediaDir, folder), { recursive: true });
  await writeFile(path.join(mediaDir, folder, name), file.buffer);
  return `${folder}/${name}`;
}

export async function deleteFile(mediaDir, relative) {
  if (!relative) return;
  try {
    await unlink(path.join(mediaDir, relative));
  } catch {
    // already gone
  }
}

export const fileUrl = (relative) => (relative ? `/media/${relative}` : null);
