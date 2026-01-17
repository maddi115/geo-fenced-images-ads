// Programmatic fence style controller
// Functions to control fence appearance via code

function setFenceFillColor(hexColor) {
  AppState.fenceStyle.fillColor = hexColor;
  scheduleRender();
}

function setFenceFillOpacity(opacity) {
  // opacity should be 0.0 to 1.0
  AppState.fenceStyle.fillOpacity = Math.max(0, Math.min(1, opacity));
  scheduleRender();
}

function setFenceBorderColor(hexColor) {
  AppState.fenceStyle.borderColor = hexColor;
  scheduleRender();
}

function setFenceBorderWidth(width) {
  AppState.fenceStyle.borderWidth = Math.max(1, Math.min(10, width));
  scheduleRender();
}

function setFenceStyle(config) {
  if (config.fillColor) AppState.fenceStyle.fillColor = config.fillColor;
  if (config.fillOpacity !== undefined) AppState.fenceStyle.fillOpacity = config.fillOpacity;
  if (config.borderColor) AppState.fenceStyle.borderColor = config.borderColor;
  if (config.borderWidth !== undefined) AppState.fenceStyle.borderWidth = config.borderWidth;
  scheduleRender();
}

function resetFenceStyle() {
  AppState.fenceStyle = {
    fillColor: '#ff006a11',
    fillOpacity: 0.03,
    borderColor: '#0066ff',
    borderWidth: 2
  };
  scheduleRender();
}
