import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { Zone, FenceStyle } from './zone-schemas';
import type { FenceLifecycle } from '../../domain/fence/fence-state';
import { transitionFenceState } from '../../domain/fence/fence-state';

interface ZoneState {
  zones: Zone[];
  activeZoneId: string | null;
  lifecycle: FenceLifecycle;
  hovered: boolean;
}

const [zoneState, setZoneState] = createStore<ZoneState>({
  zones: [],
  activeZoneId: null,
  lifecycle: 'idle',
  hovered: false,
});

const [currentImage, setCurrentImage] = createSignal<HTMLImageElement | null>(null);
const [currentZoom, setCurrentZoom] = createSignal(13);

export const zoneActions = {
  startDrawing: () => {
    const newState = transitionFenceState(zoneState.lifecycle, 'start_draw');
    setZoneState('lifecycle', newState);
    console.log('🎨 Drawing mode started');
  },

  cancelDrawing: () => {
    const newState = transitionFenceState(zoneState.lifecycle, 'cancel_draw');
    setZoneState('lifecycle', newState);
    console.log('❌ Drawing cancelled');
  },

  completeDrawing: (zone: Zone) => {
    console.log('📝 Adding zone:', zone);
    setZoneState('zones', (zones) => {
      const newZones = [...zones, zone];
      console.log('📊 Total zones now:', newZones.length);
      return newZones;
    });
    setZoneState('activeZoneId', zone.id);
    const newState = transitionFenceState(zoneState.lifecycle, 'complete_draw');
    setZoneState('lifecycle', newState);
    console.log('✅ Zone created:', zone.id);
  },

  setHovered: (hovered: boolean) => {
    setZoneState('hovered', hovered);
    console.log(hovered ? '✨ Hovered' : '🔄 Unhovered');
  },

  updateComment: (zoneId: string, text: string, posted: boolean) => {
    setZoneState(
      'zones',
      (z) => z.id === zoneId,
      'comment',
      { text, posted }
    );
  },

  setImage: (image: HTMLImageElement | null) => {
    setCurrentImage(image);
    console.log(image ? '✅ Image uploaded' : '❌ Image removed');
  },

  setZoom: (zoom: number) => {
    setCurrentZoom(zoom);
  },

  getActiveZone: () => {
    return zoneState.zones.find((z) => z.id === zoneState.activeZoneId);
  },
};

export { zoneState, currentImage, currentZoom };
