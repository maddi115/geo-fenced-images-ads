document.getElementById('upload').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      AppState.image = img; // Direct assignment, no preprocessor

      if (AppState.fence) {
        createMarker();
      }

      updateVisibility();
      scheduleRender();
      console.log('✅ Image uploaded');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
