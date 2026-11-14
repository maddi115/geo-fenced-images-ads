// Behavior while fence is being drawn (active creation)

function onFenceDrawStart() {
  FenceState.setDrawing();
  console.log('🎨 Drawing mode: Orange dashed preview');
}

function onFenceDrawing() {
  // Real-time updates while dragging vertices
  if (FenceState.isDrawing()) {
    scheduleRender();
  }
}

function onFenceDrawCancel() {
  FenceState.setIdle();
  console.log('❌ Drawing cancelled');
}
