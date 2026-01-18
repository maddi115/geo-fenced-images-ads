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

  if (shouldShowImage()) {
    renderImage();
  } else {
    renderFill();
  }
  renderBorder();
}

function shouldShowImage() {
  const zoom = map.getZoom();
  return zoom < ZOOM.AD_INFO_THRESHOLD && AppState.image && !AppState.hovered;
}

function renderImage() {
  ctx.save();
  ctx.clip();
  const bounds = AppState.fence.getBounds();
  const nw = map.latLngToContainerPoint(bounds.getNorthWest());
  const se = map.latLngToContainerPoint(bounds.getSouthEast());
  
  if (AppState.image) {
    ctx.drawImage(AppState.image, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  }
  ctx.restore();
}

function renderFill() {
  const style = AppState.fenceStyle;
  const rgb = hexToRgb(style.fillColor);
  ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${style.fillOpacity})`;
  ctx.fill();
}

function renderBorder() {
  const style = AppState.fenceStyle;
  const rgb = hexToRgb(style.borderColor);
  ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.lineWidth = style.borderWidth;
  ctx.stroke();
}
