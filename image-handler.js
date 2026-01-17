const ImageHandler = {
  handleUpload: (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        window.AppState.overlayImage = img;
        Logger.log("Image Loaded", `Size: ${img.width}x${img.height}`);
        // FORCE RENDER IMMEDIATELY
        if (typeof render === 'function') render();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
};
