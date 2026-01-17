const ZoomWatcher = {
  checkPopup: (zoom, map) => {
    const uiLabel = document.getElementById('zoomLabel');
    if (zoom >= 15 && AppState.activePolygon && AppState.overlayImage) {
      uiLabel.innerText = "Technical View";
      if (!AppState.commentPopup) ZoomWatcher.showPopup(map);
    } else {
      uiLabel.innerText = zoom <= 14 ? "Presentation View" : "Ready";
      if (AppState.commentPopup) ZoomWatcher.hidePopup(map);
    }
  },
  showPopup: (map) => {
    const div = document.createElement('div');
    div.className = 'ad-comment-card';
    div.innerHTML = `<img src="${AppState.overlayImage.src}"><textarea>${AppState.userComment}</textarea>`;
    div.querySelector('textarea').oninput = (e) => AppState.userComment = e.target.value;
    AppState.commentPopup = L.popup({ closeButton:false, offset:[0,-10] })
      .setLatLng(AppState.activePolygon.getBounds().getCenter()).setContent(div).addTo(map);
  },
  hidePopup: (map) => {
    map.removeLayer(AppState.commentPopup);
    AppState.commentPopup = null;
  }
};
