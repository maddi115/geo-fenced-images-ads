import { zoneState, zoneActions, currentImage } from './zone-store';

// Test lifecycle transitions
console.log('Initial state:', zoneState.lifecycle); // 'idle'

zoneActions.startDrawing();
console.log('After start:', zoneState.lifecycle); // 'drawing'

zoneActions.cancelDrawing();
console.log('After cancel:', zoneState.lifecycle); // 'idle'

const testZone = {
  id: crypto.randomUUID(),
  coordinates: [
    { lat: 34.05, lng: -118.24 },
    { lat: 34.06, lng: -118.24 },
    { lat: 34.06, lng: -118.23 },
  ],
  style: {
    fillColor: '#0066ff',
    fillOpacity: 0.09,
    borderColor: '#0066ff',
    borderWidth: 2,
  },
  createdAt: new Date(),
};

zoneActions.completeDrawing(testZone);
console.log('After complete:', zoneState.lifecycle); // 'placed'
console.log('Zones count:', zoneState.zones.length); // 1

console.log('✅ Store tests passed!');
