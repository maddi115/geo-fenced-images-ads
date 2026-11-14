import { encodeJxl, previewFromPixels } from './jxl';

export interface PreparedImage {
  url: string;     // data:image/jxl;base64,... (what gets saved)
  preview: string; // small PNG for the panel
  bytes: number;   // size of the JPEG XL data
}

// Shrinks an uploaded image so it fits inside maxPx x maxPx, then compresses it to JPEG XL.
export async function resizeImageFile(file: File, maxPx: number, quality = 85): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please pick an image file.');
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image.");
  }

  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported.');
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const pixels = ctx.getImageData(0, 0, w, h);
  const url = await encodeJxl(pixels, quality);
  const bytes = Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4);
  return { url, preview: previewFromPixels(pixels), bytes };
}
