// Cache rendered fence+image to avoid re-rendering
let imageCache = null;
let cacheValid = false;

function cacheClippedImage() {
  if (!AppState.fence || !AppState.image) {
    imageCache = null;
    cacheValid = false;
    return;
  }
  
  // Mark cache as valid
  cacheValid = true;
  console.log('💾 Image cache created');
}

function getCachedImage() {
  return cacheValid ? AppState.image : null;
}

function invalidateImageCache() {
  cacheValid = false;
  imageCache = null;
  console.log('🗑️ Image cache invalidated');
}
