// Track fence state throughout lifecycle
window.FenceState = {
  current: 'idle', // 'idle' | 'drawing' | 'placed'
  
  setIdle() {
    this.current = 'idle';
    console.log('🔵 Fence State: IDLE');
  },
  
  setDrawing() {
    this.current = 'drawing';
    console.log('🟡 Fence State: DRAWING');
  },
  
  setPlaced() {
    this.current = 'placed';
    console.log('🟢 Fence State: PLACED');
  },
  
  isIdle() {
    return this.current === 'idle';
  },
  
  isDrawing() {
    return this.current === 'drawing';
  },
  
  isPlaced() {
    return this.current === 'placed';
  }
};
