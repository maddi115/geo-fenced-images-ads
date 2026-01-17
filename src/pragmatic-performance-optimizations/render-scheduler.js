// Smart render scheduling - immediate for smooth performance
function scheduleRenderSmart(priority = 'immediate') {
  // Always render immediately - renders are fast (0.1-0.6ms)
  // Debouncing was causing perceived lag
  scheduleRender();
}
