// Photo checks for the scraper. Pure, so test/photo.test.ts can run them.

import type { PhotoFormat } from '../assets/static/js/alerts'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * The image format from the file's own signature. The declared content type
 * can't be trusted: FDLE serves PNGs as `image/jpeg`.
 */
export const sniffPhoto = (b: Uint8Array): PhotoFormat | null => {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (PNG_SIGNATURE.every((byte, i) => b[i] === byte)) return 'png'
  return null
}
