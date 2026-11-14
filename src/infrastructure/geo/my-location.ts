import { createSignal } from 'solid-js';
import type { LatLng } from '../../domain/geo/geo-schemas';

// The phone/computer GPS is only available to JavaScript (navigator.geolocation).
// We read it here and hand the position to the C++ engine, which draws the blue dot.

export type LocStatus = 'off' | 'locating' | 'on' | 'denied' | 'insecure' | 'error';

const [myLocation, setMyLocation] = createSignal<{ at: LatLng; accuracy: number } | null>(null);
const [locStatus, setLocStatus] = createSignal<LocStatus>('off');
let watchId: number | null = null;

export { myLocation, locStatus };

export function startLocation() {
  if (!window.isSecureContext) {
    // browsers only allow location on https:// or localhost
    setLocStatus('insecure');
    return;
  }
  if (!('geolocation' in navigator)) {
    setLocStatus('error');
    return;
  }
  if (watchId !== null) return;
  setLocStatus('locating');
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      setMyLocation({ at: { lat: pos.coords.latitude, lng: pos.coords.longitude }, accuracy: pos.coords.accuracy });
      setLocStatus('on');
    },
    (err) => {
      setLocStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
      stopLocation(false);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

export function stopLocation(clear = true) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (clear) {
    setMyLocation(null);
    setLocStatus('off');
  }
}

export function locStatusText(s: LocStatus): string {
  switch (s) {
    case 'locating': return 'Finding your location…';
    case 'denied': return 'Location permission was blocked. Allow it in your browser settings.';
    case 'insecure': return 'Location needs https:// (or localhost). Open the tunnel link on your phone.';
    case 'error': return "Couldn't get your location.";
    default: return '';
  }
}
