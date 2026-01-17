const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([34.0522, -118.2437], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

AppState.canvas = document.createElement('canvas');
AppState.canvas.style.position = 'absolute';
AppState.canvas.style.top = "0"; AppState.canvas.style.left = "0";
AppState.canvas.style.pointerEvents = 'none';
map.getPanes().overlayPane.appendChild(AppState.canvas);
AppState.ctx = AppState.canvas.getContext('2d');

window.addEventListener('resize', () => render());
