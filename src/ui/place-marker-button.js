// "Place Marker" button component logic

let placementModeActive = false;

function togglePlacementMode() {
  if (!AppState.fence) {
    console.warn('⚠️ Draw a fence first!');
    alert('Please draw a fence first!');
    return;
  }
  
  placementModeActive = !placementModeActive;
  const btn = document.getElementById('placeMarkerBtn');
  
  if (placementModeActive) {
    // Activate placement mode
    btn.textContent = "Click inside fence...";
    btn.classList.add('active');
    map.getContainer().style.cursor = 'crosshair';
    console.log('🎯 Marker placement mode: ACTIVE');
  } else {
    // Deactivate placement mode
    btn.textContent = "Place Marker";
    btn.classList.remove('active');
    map.getContainer().style.cursor = '';
    console.log('🎯 Marker placement mode: INACTIVE');
  }
}

function deactivatePlacementMode() {
  if (placementModeActive) {
    togglePlacementMode();
  }
}

function isPlacementModeActive() {
  return placementModeActive;
}
