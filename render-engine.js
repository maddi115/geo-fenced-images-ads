let renderScheduled = false;

function scheduleRender() {
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(() => {
      render();
      renderScheduled = false;
    });
  }
}

function render() {
  if (!State.poly) return;
  const zoom = map.getZoom();
  const size = map.getSize();

  if (canvas.width !== size.x || canvas.height !== size.y) {
    canvas.width = size.x;
    canvas.height = size.y;
  }

  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0,0]));

  const latlngs = State.poly.getLatLngs()[0];
  const pts = latlngs.map(ll => map.latLngToContainerPoint(ll));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();

  if (zoom <= 14 && State.img) {
    ctx.save(); ctx.clip();
    const b = State.poly.getBounds();
    const nw = map.latLngToContainerPoint(b.getNorthWest());
    const se = map.latLngToContainerPoint(b.getSouthEast());
    ctx.drawImage(State.img, nw.x, nw.y, se.x-nw.x, se.y-nw.y);
    ctx.restore();
    document.getElementById('zoomLabel').innerText = "MACRO VIEW";
  } else {
    ctx.fillStyle = "rgba(0, 102, 255, 0.2)";
    ctx.fill();
    document.getElementById('zoomLabel').innerText = "TECHNICAL VIEW";
  }
  ctx.strokeStyle = "#0066ff"; ctx.lineWidth = 2; ctx.stroke();
  managePopup(zoom);
}

function managePopup(z) {
  if (z >= 15 && State.poly && State.img) {
    if (!State.popup) {
      const d = document.createElement('div');
      d.className = 'ad-comment-card';
      d.innerHTML = `<img src="${State.img.src}"><textarea>${State.note}</textarea>`;
      d.querySelector('textarea').oninput = (e) => State.note = e.target.value;
      State.popup = L.popup({ closeButton: false, offset: [0, -10] })
        .setLatLng(State.poly.getBounds().getCenter()).setContent(d).addTo(map);
    } else {
      State.popup.setLatLng(State.poly.getBounds().getCenter());
    }
  } else if (State.popup) {
    map.removeLayer(State.popup);
    State.popup = null;
  }
}
