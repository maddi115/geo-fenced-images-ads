// Resize and optimize images before storing
const MAX_IMAGE_DIMENSION = 2048;

function preprocessImage(imageElement) {
  if (needsResize(imageElement)) {
    PerfMetrics.logImageResize();
    console.log('📉 Resizing large image for performance');
    return resizeImage(imageElement);
  }
  return imageElement;
}

function needsResize(img) {
  return img.width > MAX_IMAGE_DIMENSION || img.height > MAX_IMAGE_DIMENSION;
}

function resizeImage(img) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  let width = img.width;
  let height = img.height;
  
  if (width > height) {
    if (width > MAX_IMAGE_DIMENSION) {
      height = (height * MAX_IMAGE_DIMENSION) / width;
      width = MAX_IMAGE_DIMENSION;
    }
  } else {
    if (height > MAX_IMAGE_DIMENSION) {
      width = (width * MAX_IMAGE_DIMENSION) / height;
      height = MAX_IMAGE_DIMENSION;
    }
  }
  
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);
  
  const resizedImg = new Image();
  resizedImg.src = canvas.toDataURL('image/jpeg', 0.9);
  return resizedImg;
}
