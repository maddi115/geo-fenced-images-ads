// Marker placement handler - map click logic only

// Handle map clicks for marker placement
map.on('click', (e) => {
  if (!isPlacementModeActive()) return;
  if (!AppState.fence) return;
  
  const clickedPoint = e.latlng;
  const fenceLatLngs = AppState.fence.getLatLngs()[0];
  
  if (isPointInPolygon(clickedPoint, fenceLatLngs)) {
    placeMarkerAt(clickedPoint);
    deactivatePlacementMode(); // Exit placement mode after placing
    console.log('✅ Marker placed at:', clickedPoint);
  } else {
    console.warn('⚠️ Click inside the fence!');
    alert('Please click inside the fence boundary!');
  }
});

// Point-in-polygon algorithm (ray casting)
function isPointInPolygon(point, polygon) {
  let inside = false;
  const x = point.lat;
  const y = point.lng;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat;
    const yi = polygon[i].lng;
    const xj = polygon[j].lat;
    const yj = polygon[j].lng;
    
    const intersect = ((yi > y) !== (yj > y)) && 
                      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  
  return inside;
}
