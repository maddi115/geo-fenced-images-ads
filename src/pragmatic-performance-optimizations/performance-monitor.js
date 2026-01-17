// Performance metrics tracking
window.PerfMetrics = {
  renderCount: 0,
  rendersCulled: 0,
  imagesResized: 0,
  cacheHits: 0,
  lastRenderTime: 0,
  
  logRender(culled = false) {
    if (culled) {
      this.rendersCulled++;
    } else {
      this.renderCount++;
    }
  },
  
  logImageResize() {
    this.imagesResized++;
  },
  
  logCacheHit() {
    this.cacheHits++;
  },
  
  logRenderTime(ms) {
    this.lastRenderTime = ms;
  },
  
  report() {
    console.log('📊 PERFORMANCE METRICS:');
    console.log(`  Renders: ${this.renderCount}`);
    console.log(`  Culled (skipped): ${this.rendersCulled}`);
    console.log(`  Images resized: ${this.imagesResized}`);
    console.log(`  Cache hits: ${this.cacheHits}`);
    console.log(`  Last render: ${this.lastRenderTime.toFixed(2)}ms`);
    console.log(`  Cull efficiency: ${((this.rendersCulled / (this.renderCount + this.rendersCulled)) * 100).toFixed(1)}%`);
  }
};

// Auto-report every 10 seconds
setInterval(() => PerfMetrics.report(), 10000);
