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

function hexToRgb(hex) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 153, g: 50, b: 204 };
}

function render() {
  if (!AppState.fence) return;

  const zoom = map.getZoom();
  const size = map.getSize();

  if (canvas.width !== size.x || canvas.height !== size.y) {
    canvas.width = size.x;
    canvas.height = size.y;
  }

  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

  const latlngs = AppState.fence.getLatLngs()[0];
  const points = latlngs.map(ll => map.latLngToContainerPoint(ll));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();

  // Show image at LOW zoom (zoomed out), show blue fill at HIGH zoom (zoomed in)
  if (zoom < 16 && AppState.image && !AppState.adInfoHovered) {
    ctx.save();
    ctx.clip();
    const bounds = AppState.fence.getBounds();
    const nw = map.latLngToContainerPoint(bounds.getNorthWest());
    const se = map.latLngToContainerPoint(bounds.getSouthEast());
    ctx.drawImage(AppState.image, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
    ctx.restore();
  } else {
    // Show blue fill if: hovered OR zoom >= 16
    const style = AppState.fenceStyle;
    const rgb = hexToRgb(style.fillColor);
    const fillString = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${style.fillOpacity})`;
    ctx.fillStyle = fillString;
    ctx.fill();
  }

  const style = AppState.fenceStyle;
  const borderRgb = hexToRgb(style.borderColor);
  ctx.strokeStyle = `rgb(${borderRgb.r}, ${borderRgb.g}, ${borderRgb.b})`;
  ctx.lineWidth = style.borderWidth;
  ctx.stroke();

  updateZoomView(zoom);
  updateFenceCursor();
}
