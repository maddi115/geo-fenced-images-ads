window.State = { poly: null, img: null, note: "", popup: null };

const map = L.map('map', { zoomControl: false }).setView([34.0522, -118.2437], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.pointerEvents = 'none';
map.getPanes().overlayPane.appendChild(canvas);
const ctx = canvas.getContext('2d');

const drawnItems = new L.FeatureGroup().addTo(map);
map.addControl(new L.Control.Draw({
  draw: { polygon: true, rectangle: true, marker: false, circle: false, polyline: false, circlemarker: false }
}));

map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers();
  State.poly = e.layer;
  drawnItems.addLayer(State.poly);
  scheduleRender();
});

document.getElementById('upload').onchange = (e) => {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const i = new Image();
    i.onload = () => { State.img = i; scheduleRender(); };
    i.src = ev.target.result;
  };
  reader.readAsDataURL(e.target.files[0]);
};

map.on('zoomend moveend', scheduleRender);
window.addEventListener('resize', scheduleRender);
