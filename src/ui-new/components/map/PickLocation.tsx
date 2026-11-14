import { Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { MapEngine } from '../../../infrastructure/engine/engine';
import type { LatLng } from '../../../domain/geo/geo-schemas';
import { postActions } from '../../../use-cases/posts/posts-store';
import { myAt } from '../../../infrastructure/geo/my-location';

// "Adjust the pin" screen: a pin fixed in the middle, the map slides under it,
// and the cross streets above the pin update as you move.
export const PickLocation: Component<{ engine: MapEngine }> = (props) => {
  const [address, setAddress] = createSignal<string | null>(null);
  const [moving, setMoving] = createSignal(false);
  let raf = 0;
  let last: LatLng | null = null;
  let stillSince = 0;
  let lastLookup = 0;
  let lookedUp: LatLng | null = null;

  const same = (a: LatLng | null, b: LatLng | null) =>
    !!a && !!b && Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lng - b.lng) < 1e-7;

  const tick = () => {
    const c = props.engine.center();
    const now = performance.now();
    if (!same(c, last)) {
      last = c;
      stillSince = now;
      setMoving(true);
    }
    // live: look the address up every ~150 ms while moving, and once more when it settles
    if (!same(c, lookedUp) && now - lastLookup > 150) {
      lastLookup = now;
      const a = props.engine.addressNow(c); // C++ nearest-intersection search, < 1 ms
      if (a !== null) { lookedUp = c; setAddress(a); } // null = street data still loading
    }
    if (now - stillSince > 150) setMoving(false);
    raf = requestAnimationFrame(tick);
  };

  onMount(() => {
    // start where you are, if we know it
    const me = myAt();
    if (me) props.engine.flyTo(me, Math.max(props.engine.zoom, 16));
    raf = requestAnimationFrame(tick);
  });
  onCleanup(() => cancelAnimationFrame(raf));

  const label = () => (address() === null ? 'Finding cross streets…' : address() || 'No street names here');

  return (
    <div class="pick-layer">
      <div class="pick-center">
        <div class={`pick-address ${moving() ? 'is-moving' : ''}`}>{label()}</div>
        <svg class={`pick-pin ${moving() ? 'lifted' : ''}`} viewBox="0 0 24 36" width="34" height="50" aria-hidden="true">
          <path fill="#ea4335" stroke="#b31412" stroke-width="1"
            d="M12 1C5.9 1 1 5.9 1 12c0 8.3 11 22 11 22s11-13.7 11-22C23 5.9 18.1 1 12 1z" />
          <circle cx="12" cy="12" r="4.2" fill="#fff" />
        </svg>
        <div class="pick-shadow" />
      </div>

      <div class="pick-bar">
        <button class="pick-btn ghost" onClick={() => postActions.cancelPicking()}>Cancel</button>
        <Show when={myAt()}>
          <button class="pick-btn ghost" onClick={() => props.engine.flyTo(myAt()!, Math.max(props.engine.zoom, 16))}>
            My location
          </button>
        </Show>
        <button class="pick-btn primary" onClick={() => postActions.setPicked(props.engine.center())}>
          Set location
        </button>
      </div>
    </div>
  );
};
