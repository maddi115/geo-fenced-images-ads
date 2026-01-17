// Fence style controls - color, opacity, border
function initFenceStyler() {
  const fillColorInput = document.getElementById('fillColor');
  const fillOpacityInput = document.getElementById('fillOpacity');
  const fillOpacityValue = document.getElementById('fillOpacityValue');
  const borderColorInput = document.getElementById('borderColor');
  const borderWidthInput = document.getElementById('borderWidth');
  const borderWidthValue = document.getElementById('borderWidthValue');
  
  // Fill color
  fillColorInput.addEventListener('input', (e) => {
    AppState.fenceStyle.fillColor = e.target.value;
    scheduleRender();
  });
  
  // Fill opacity
  fillOpacityInput.addEventListener('input', (e) => {
    const opacity = e.target.value / 100;
    AppState.fenceStyle.fillOpacity = opacity;
    fillOpacityValue.textContent = e.target.value + '%';
    scheduleRender();
  });
  
  // Border color
  borderColorInput.addEventListener('input', (e) => {
    AppState.fenceStyle.borderColor = e.target.value;
    scheduleRender();
  });
  
  // Border width
  borderWidthInput.addEventListener('input', (e) => {
    AppState.fenceStyle.borderWidth = parseInt(e.target.value);
    borderWidthValue.textContent = e.target.value + 'px';
    scheduleRender();
  });
}

// Toggle style panel visibility
function toggleStylePanel() {
  const panel = document.getElementById('stylePanel');
  const btn = document.getElementById('toggleStyleBtn');
  
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'block';
    btn.textContent = '▼ Hide Styles';
  } else {
    panel.style.display = 'none';
    btn.textContent = '▶ Fence Styles';
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFenceStyler);
} else {
  initFenceStyler();
}
