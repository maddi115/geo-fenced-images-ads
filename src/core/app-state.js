// Single source of truth for application state
window.AppState = {
  fence: null,
  image: null,
  marker: null,
  commentBubble: null,
  commentText: "",
  commentPosted: false,
  drawnItems: null,
  
  // View state
  hovered: false,
  
  // Style
  fenceStyle: {
    fillColor: '#0066ff',
    fillOpacity: 0.3,
    borderColor: '#0066ff',
    borderWidth: 2
  }
};
