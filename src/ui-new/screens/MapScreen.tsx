import { Component, onMount, createMemo, createSignal } from 'solid-js';
import { zoneActions, zoneState, currentImage, currentZoom } from '../../use-cases/custom-zones/zone-store';
import { LeafletAdapter } from '../../infrastructure/adapters/map-adapter';
import { ZoneCanvas } from '../components/map/ZoneCanvas';
import { MarkerController } from '../components/map/MarkerController';
import { ZOOM } from '../../config-new/constants';
import { calculateViewMode, getVisibilityActions } from '../../domain/visibility/visibility-rules';

export const MapScreen: Component = () => {
  const mapAdapter = new LeafletAdapter();
  
  const [markerElement, setMarkerElement] = createSignal<HTMLElement | null>(null);
  const [bubbleElement, setBubbleElement] = createSignal<HTMLElement | null>(null);

  onMount(() => {
    mapAdapter.initialize('map-container');
    zoneActions.setZoom(mapAdapter.getZoom());

    mapAdapter.onDrawStart(() => {
      zoneActions.startDrawing();
    });

    mapAdapter.onDrawComplete((coords) => {
      const zone = {
        id: crypto.randomUUID(),
        coordinates: coords,
        style: {
          fillColor: '#0066ff',
          fillOpacity: 0.09,
          borderColor: '#0066ff',
          borderWidth: 2,
        },
        createdAt: new Date(),
      };
      zoneActions.completeDrawing(zone);
    });

    mapAdapter.onDrawCancel(() => {
      zoneActions.cancelDrawing();
    });

    mapAdapter.onZoomChange((zoom) => {
      zoneActions.setZoom(zoom);
      zoneActions.setHovered(false);
    });

    // Hover listeners
    mapAdapter.onHover(() => {
      if (currentZoom() < ZOOM.AD_INFO_THRESHOLD) {
        zoneActions.setHovered(true);
        console.log('✨ Hovered - showing ad info');
      }
    });

    mapAdapter.onUnhover((relatedTarget) => {
      if (currentZoom() < ZOOM.AD_INFO_THRESHOLD) {
        // Persistence check (Source of Truth)
        if (isMovingToMarkerOrBubble(relatedTarget)) {
          console.log('⏸️ Maintaining hover - on marker/bubble');
          return;
        }
        zoneActions.setHovered(false);
        console.log('🔄 Unhovered - back to image');
      }
    });
  });

  function isMovingToMarkerOrBubble(relatedTarget: any): boolean {
    if (!relatedTarget) return false;

    const marker = markerElement();
    const bubble = bubbleElement();

    if (marker && (relatedTarget === marker || marker.contains(relatedTarget))) {
      return true;
    }

    if (bubble && (relatedTarget === bubble || bubble.contains(relatedTarget))) {
      return true;
    }

    return false;
  }

  const viewLabel = createMemo(() => {
    const mode = calculateViewMode({
      zoom: currentZoom(),
      zoomThreshold: ZOOM.AD_INFO_THRESHOLD,
      hasImage: !!currentImage(),
      isHovered: zoneState.hovered,
    });
    return getVisibilityActions(mode).label;
  });

  return (
    <div>
      <div id="map-container" style={{ width: '100vw', height: '100vh' }} />

      <ZoneCanvas mapAdapter={mapAdapter} />

      <MarkerController 
        mapAdapter={mapAdapter} 
        onMarkerElementChange={setMarkerElement}
        onBubbleElementChange={setBubbleElement}
      />

      <div
        class="interface-layer"
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          'z-index': '1000',
          display: 'flex',
          'flex-direction': 'column',
          gap: '10px',
        }}
      >
        <div id="zoomLabel" style={{
          background: 'white',
          padding: '8px 16px',
          'border-radius': '4px',
          'font-family': 'monospace',
          'font-weight': 'bold',
        }}>
          {viewLabel()}
        </div>

        <input
          type="file"
          id="upload"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (ev) => {
              const img = new Image();
              img.onload = () => {
                zoneActions.setImage(img);
              };
              img.src = ev.target?.result as string;
            };
            reader.readAsDataURL(file);
          }}
        />

        <button onClick={() => window.location.reload()}>Reset</button>
      </div>
    </div>
  );
};
