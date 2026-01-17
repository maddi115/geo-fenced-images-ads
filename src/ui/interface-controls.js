// Main UI toolbar controls and initialization

function initializeUI() {
  // Zoom label
  const zoomLabel = document.getElementById('zoomLabel');
  
  // Upload button
  const uploadBtn = document.getElementById('upload');
  
  // Place Marker button
  const placeMarkerBtn = document.getElementById('placeMarkerBtn');
  
  // Reset button
  const resetBtn = document.querySelector('button[onclick="location.reload()"]');
  
  console.log('🎮 UI Controls initialized');
}

function disableButton(buttonId) {
  const btn = document.getElementById(buttonId);
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  }
}

function enableButton(buttonId) {
  const btn = document.getElementById(buttonId);
  if (btn) {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeUI);
} else {
  initializeUI();
}
