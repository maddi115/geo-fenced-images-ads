// Initialize map
window.map = L.map('map', { 
  zoomControl: false,
  attributionControl: false 
}).setView([34.0522, -118.2437], 15);

// Add tile layer
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 19
}).addTo(map);

// Create canvas for custom rendering
window.canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.pointerEvents = 'none';
canvas.style.zIndex = '400';
map.getPanes().overlayPane.appendChild(canvas);

window.ctx = canvas.getContext('2d');

// Initialize feature group
AppState.drawnItems = new L.FeatureGroup().addTo(map);

// Setup drawing control
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
