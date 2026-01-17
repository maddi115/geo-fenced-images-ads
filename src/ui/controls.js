// UI controls
document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      // Preprocess image for performance
      AppState.image = preprocessImage(img);
      
      if (AppState.marker && AppState.fence) {
        createMarker();
      } else if (AppState.fence) {
        createMarker();
      }
      
      // Cache the clipped image
      cacheClippedImage();
      
      updateVisibility();
      console.log('✅ Image uploaded and optimized');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// Disable double-click zoom
map.doubleClickZoom.disable();
console.log('🚫 Double-click zoom disabled');
