// Handle image upload
document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      AppState.image = img;
      
      // Update marker with image if marker exists
      if (AppState.marker && AppState.fence) {
        const currentLatLng = AppState.marker.getLatLng();
        placeMarkerAt(currentLatLng);
      } else if (AppState.fence) {
        // Create marker if it doesn't exist
        createMarker();
      }
      
      scheduleRender();
      console.log('✅ Image uploaded and marker updated');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
