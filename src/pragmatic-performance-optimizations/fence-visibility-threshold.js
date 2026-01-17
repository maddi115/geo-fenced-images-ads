// Hide fence below minimum zoom threshold for performance
const FENCE_MIN_ZOOM = 11;

function shouldRenderFence() {
  return map.getZoom() >= FENCE_MIN_ZOOM;
}
