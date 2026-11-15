import { encodeJxl, previewFromPixels } from './jxl';
import { devLog } from '../dev/dev-log';

export interface PreparedImage {
  url: string;     // data:image/jxl;base64,... (what gets saved)
  preview: string; // small PNG for the panel
  bytes: number;   // size of the JPEG XL data
  originalBytes: number; // size of the file the user picked
  encodeMs: number;
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

  const srcW = bmp.width, srcH = bmp.height;
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
  const t0 = performance.now();
  const url = await encodeJxl(pixels, quality);
  const encodeMs = performance.now() - t0;
  const bytes = Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4);

  // what a plain PNG of the same resized picture would be, to compare
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const pct = (n: number) => `${Math.max(0, Math.round((1 - bytes / n) * 100))}% smaller`;
  devLog(
    'jxl stats',
    `${file.type.replace('image/', '').toUpperCase()} ${srcW}x${srcH} ${kb(file.size)} -> JPEG XL ${w}x${h} ${kb(bytes)} ` +
      `(${pct(file.size)} than the upload` + (png ? `, ${pct(png.size)} than PNG ${kb(png.size)}` : '') +
      `) · quality ${quality} · encoded in ${encodeMs.toFixed(0)} ms`,
  );
  return { url, preview: previewFromPixels(pixels), bytes, originalBytes: file.size, encodeMs };
}
