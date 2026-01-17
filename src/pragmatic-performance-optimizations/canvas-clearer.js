// Clear canvas when content shouldn't be visible
function clearCanvasIfNeeded() {
  if (!AppState.fence) return false;
  
  // Clear if below minimum zoom
  if (!shouldRenderFence()) {
    clearCanvas();
    return true; // Cleared, skip render
  }
  
  // Clear if off-screen
  if (!isFenceInViewport()) {
    clearCanvas();
    return true; // Cleared, skip render
  }
  
  return false; // Continue rendering
}

function clearCanvas() {
  const size = map.getSize();
  if (canvas.width !== size.x || canvas.height !== size.y) {
    canvas.width = size.x;
    canvas.height = size.y;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
