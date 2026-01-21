/**
 * Fence lifecycle state machine
 * Extracted from state-tracking.js
 */

export type FenceLifecycle = 'idle' | 'drawing' | 'placed';

export type FenceEvent = 'start_draw' | 'cancel_draw' | 'complete_draw';

export function transitionFenceState(
  current: FenceLifecycle,
  event: FenceEvent
): FenceLifecycle {
  switch (event) {
    case 'start_draw':
      return 'drawing';
    case 'cancel_draw':
      return 'idle';
    case 'complete_draw':
      return 'placed';
    default:
      return current;
  }
}

export function getFenceStateLabel(state: FenceLifecycle): string {
  switch (state) {
    case 'idle':
      return '🔵 Fence State: IDLE';
    case 'drawing':
      return '🟡 Fence State: DRAWING';
    case 'placed':
      return '🟢 Fence State: PLACED';
  }
}
