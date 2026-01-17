// Skip rendering when fence is off-screen
function isFenceInViewport() {
  if (!AppState.fence) return false;
  
  const mapBounds = map.getBounds();
  const fenceBounds = AppState.fence.getBounds();
  
  return mapBounds.intersects(fenceBounds);
}
