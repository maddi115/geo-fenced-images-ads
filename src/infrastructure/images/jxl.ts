// JPEG XL support for uploaded images.
//   encode: always done with the libjxl WebAssembly encoder (works in every browser)
//   decode: the browser's own JPEG XL decoder when it has one (Safari, newer Chrome),
//           otherwise the libjxl WebAssembly decoder. The map engine needs raw pixels
//           anyway, so JPEG XL works everywhere.

export const JXL_MIME = 'image/jxl';

export async function encodeJxl(pixels: ImageData, quality: number): Promise<string> {
  const { encode } = await import('@jsquash/jxl');
  // effort 4 = fast enough to feel instant on upload, still much smaller than JPEG/PNG
  const buf = await encode(pixels, { quality, effort: 4 });
  return `data:${JXL_MIME};base64,${toBase64(new Uint8Array(buf))}`;
}

/** Any image data URL (jxl, png, jpeg...) -> ImageBitmap ready to draw */
export async function decodeToBitmap(url: string): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  try {
    return await createImageBitmap(blob); // native decoder (all formats it knows, incl. JXL if supported)
  } catch (e) {
    if (!url.startsWith(`data:${JXL_MIME}`)) throw e;
    const { decode } = await import('@jsquash/jxl');
    const pixels = await decode(await blob.arrayBuffer());
    return createImageBitmap(pixels);
  }
}

/** Small PNG preview for the panel (browsers without JPEG XL can't show .jxl in an <img>) */
export function previewFromPixels(pixels: ImageData, size = 96): string {
  const s = Math.min(1, size / Math.max(pixels.width, pixels.height));
  const full = document.createElement('canvas');
  full.width = pixels.width;
  full.height = pixels.height;
  full.getContext('2d')!.putImageData(pixels, 0, 0);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(pixels.width * s));
  c.height = Math.max(1, Math.round(pixels.height * s));
  c.getContext('2d')!.drawImage(full, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
