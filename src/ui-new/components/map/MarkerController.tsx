import { Component, createEffect, onCleanup } from 'solid-js';
import { zoneState, currentImage, currentZoom } from '../../../use-cases/custom-zones/zone-store';
import { calculateViewMode, getVisibilityActions } from '../../../domain/visibility/visibility-rules';
import { ZOOM } from '../../../config-new/constants';
import type { LeafletAdapter } from '../../../infrastructure/adapters/map-adapter';
import { 
  createMarker, 
  showMarker, 
  hideMarker, 
  getMarkerElement,
  destroyMarker 
} from './marker-imperative';
import { 
  showCommentBubble, 
  hideCommentBubble, 
  getCommentBubbleElement,
  destroyCommentBubble 
} from './bubble-imperative';

interface MarkerControllerProps {
  mapAdapter: LeafletAdapter;
  onMarkerElementChange: (el: HTMLElement | null) => void;
  onBubbleElementChange: (el: HTMLElement | null) => void;
}

export const MarkerController: Component<MarkerControllerProps> = (props) => {
  
  // Effect 1: Create/Update Marker
  createEffect(() => {
    const activeZone = zoneState.zones[zoneState.zones.length - 1];
    if (!activeZone) return;

    const image = currentImage();
    const map = props.mapAdapter.getMapInstance();
    
    // Calculate center
    const lats = activeZone.coordinates.map(c => c.lat);
    const lngs = activeZone.coordinates.map(c => c.lng);
    const center: [number, number] = [
      (Math.max(...lats) + Math.min(...lats)) / 2,
      (Math.max(...lngs) + Math.min(...lngs)) / 2
    ];

    // Create marker (vanilla JS)
    createMarker(map, center, image);
    
    // Get DOM element and notify parent
    setTimeout(() => {
      const el = getMarkerElement();
      if (el) props.onMarkerElementChange(el);
    }, 10);
  });

  // Effect 2: Control Visibility
  createEffect(() => {
    const mode = calculateViewMode({
      zoom: currentZoom(),
      zoomThreshold: ZOOM.AD_INFO_THRESHOLD,
      hasImage: !!currentImage(),
      isHovered: zoneState.hovered,
    });
    const actions = getVisibilityActions(mode);

    // Update marker visibility
    if (actions.showMarker) {
      showMarker();
    } else {
      hideMarker();
    }

    // Update bubble visibility
    const markerEl = getMarkerElement();
    if (actions.showComment && currentImage()) {
      showCommentBubble(markerEl);
      props.onBubbleElementChange(getCommentBubbleElement());
    } else {
      hideCommentBubble();
    }
  });

  onCleanup(() => {
    destroyMarker(props.mapAdapter.getMapInstance());
    destroyCommentBubble();
  });

  return null; // No JSX - purely imperative
};
