window.map = L.map('map', {
  zoomControl: false,
  attributionControl: false
}).setView(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);

L.maplibreGL({
  style: 'https://tiles.openfreemap.org/styles/bright'
}).addTo(map);

window.canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.pointerEvents = 'none';
canvas.style.zIndex = '200';  // Below fence layer (400) so hover works
map.getPanes().overlayPane.appendChild(canvas);
window.ctx = canvas.getContext('2d');

AppState.drawnItems = new L.FeatureGroup().addTo(map);

map.addControl(new L.Control.Draw({
  draw: {
    polygon: true,
    rectangle: true,
    marker: false,
    circle: false,
    polyline: false,
    circlemarker: false
  },
  edit: {
    featureGroup: AppState.drawnItems
  }
}));
