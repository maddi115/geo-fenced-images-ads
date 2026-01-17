let activePolygon = null;
const drawnItems = new L.FeatureGroup().addTo(map);

map.addControl(new L.Control.Draw({
  draw: { 
    polygon: { shapeOptions: { color: '#0066ff', weight: 2, fillOpacity: 0 } },
    rectangle: { shapeOptions: { color: '#0066ff', weight: 2, fillOpacity: 0 } },
    marker: false, polyline: false, circle: false, circlemarker: false 
  }
}));

map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers();
  activePolygon = e.layer;
  drawnItems.addLayer(activePolygon);
  render();
});

function resetAll() {
  drawnItems.clearLayers();
  activePolygon = null;
  overlayImage = null;
  if (commentPopup) map.removeLayer(commentPopup);
  commentPopup = null;
  document.getElementById('upload').value = '';
  render();
}
