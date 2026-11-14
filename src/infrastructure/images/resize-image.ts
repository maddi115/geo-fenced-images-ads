// Shrinks an uploaded image so it fits inside maxPx x maxPx,
// and returns it as a data URL (text) that can be saved.
export async function resizeImageFile(
  file: File,
  maxPx: number,
  format: 'image/png' | 'image/jpeg' = 'image/png'
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please pick an image file.');
  }

  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image."));
      el.src = srcUrl;
    });

    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not supported.');
    ctx.drawImage(img, 0, 0, w, h);

    return format === 'image/jpeg' ? canvas.toDataURL(format, 0.85) : canvas.toDataURL(format);
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}
