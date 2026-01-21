import { calculateViewMode, getVisibilityActions } from './visibility-rules';

// Simple test
const mode = calculateViewMode({
  zoom: 17,
  zoomThreshold: 16,
  hasImage: true,
  isHovered: false,
});

console.log('Mode:', mode); // Should be 'technical'
console.log('Actions:', getVisibilityActions(mode));

if (mode !== 'technical') {
  throw new Error('Test failed!');
}

console.log('✅ Tests passed!');
