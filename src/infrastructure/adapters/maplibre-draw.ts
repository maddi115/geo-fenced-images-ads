import type { Map as MlMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import type { LatLng } from '../../domain/geo/geo-schemas';

// Small zone drawing tool for MapLibre (replaces leaflet-draw).
//   rect: press, drag, release
//   poly: click points; click the first point or double-click to finish; Esc cancels
export type DrawKind = 'rect' | 'poly';

const SRC = 'draw-preview';

export class ZoneDrawer {
  private kind: DrawKind | null = null;
  private points: LatLng[] = [];
  private hover: LatLng | null = null;
  private rectStart: LatLng | null = null;

  constructor(
    private map: MlMap,
    private onDone: (coords: LatLng[]) => void,
    private onCancel: () => void
  ) {}

  install() {
    this.map.addSource(SRC, { type: 'geojson', data: empty() });
    this.map.addLayer({
      id: 'draw-fill',
      type: 'fill',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': '#0066ff', 'fill-opacity': 0.12 },
    });
    this.map.addLayer({
      id: 'draw-line',
      type: 'line',
      source: SRC,
      paint: { 'line-color': '#0066ff', 'line-width': 2, 'line-dasharray': [2, 1] },
    });
    this.map.addLayer({
      id: 'draw-points',
      type: 'circle',
      source: SRC,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#0066ff', 'circle-stroke-width': 2 },
    });
  }

  start(kind: DrawKind) {
    this.stop(false);
    this.kind = kind;
    this.points = [];
    this.rectStart = null;
    this.map.getCanvasContainer().classList.add('drawing');
    this.map.doubleClickZoom.disable();
    if (kind === 'rect') this.map.dragPan.disable();

    this.map.on('mousedown', this.onDown);
    this.map.on('mousemove', this.onMove);
    this.map.on('mouseup', this.onUp);
    this.map.on('click', this.onClick);
    this.map.on('dblclick', this.onDbl);
    window.addEventListener('keydown', this.onKey);
  }

  stop(cancelled = true) {
    if (!this.kind) return;
    this.kind = null;
    this.map.getCanvasContainer().classList.remove('drawing');
    this.map.dragPan.enable();
    setTimeout(() => this.map.doubleClickZoom.enable(), 0);
    this.map.off('mousedown', this.onDown);
    this.map.off('mousemove', this.onMove);
    this.map.off('mouseup', this.onUp);
    this.map.off('click', this.onClick);
    this.map.off('dblclick', this.onDbl);
    window.removeEventListener('keydown', this.onKey);
    this.points = [];
    this.hover = null;
    this.rectStart = null;
    this.paint();
    if (cancelled) this.onCancel();
  }

  get active() {
    return this.kind !== null;
  }

  private finish(coords: LatLng[]) {
    this.stop(false);
    this.onDone(coords);
  }

  private onDown = (e: MapMouseEvent) => {
    if (this.kind !== 'rect') return;
    e.preventDefault();
    this.rectStart = ll(e);
  };

  private onMove = (e: MapMouseEvent) => {
    this.hover = ll(e);
    this.paint();
  };

  private onUp = (e: MapMouseEvent) => {
    if (this.kind !== 'rect' || !this.rectStart) return;
    const a = this.rectStart;
    const b = ll(e);
    const pa = this.map.project([a.lng, a.lat]);
    const pb = this.map.project([b.lng, b.lat]);
    if (Math.abs(pa.x - pb.x) < 8 || Math.abs(pa.y - pb.y) < 8) {
      this.rectStart = null; // too small, keep drawing
      this.paint();
      return;
    }
    this.finish(rectCorners(a, b));
  };

  private onClick = (e: MapMouseEvent) => {
    if (this.kind !== 'poly') return;
    const p = ll(e);
    if (this.points.length >= 3) {
      const first = this.map.project([this.points[0].lng, this.points[0].lat]);
      if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 12) {
        this.finish([...this.points]);
        return;
      }
    }
    this.points.push(p);
    this.paint();
  };

  private onDbl = (e: MapMouseEvent) => {
    if (this.kind !== 'poly') return;
    e.preventDefault();
    // the double-click also fired a click that added a duplicate point
    const pts = this.points.slice(0, -1);
    if (pts.length >= 3) this.finish(pts);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.stop(true);
  };

  private paint() {
    const src = this.map.getSource(SRC) as GeoJSONSource | undefined;
    if (!src) return;
    const features: any[] = [];
    if (this.kind === 'rect' && this.rectStart && this.hover) {
      features.push(polygon(rectCorners(this.rectStart, this.hover)));
    } else if (this.kind === 'poly' && this.points.length) {
      const line = this.hover ? [...this.points, this.hover] : this.points;
      if (line.length >= 3) features.push(polygon(line));
      else features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.map(toXY) } });
      this.points.forEach((p) => features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: toXY(p) } }));
    }
    src.setData({ type: 'FeatureCollection', features });
  }
}

const ll = (e: MapMouseEvent): LatLng => ({ lat: e.lngLat.lat, lng: e.lngLat.lng });
const toXY = (p: LatLng) => [p.lng, p.lat];
const empty = () => ({ type: 'FeatureCollection' as const, features: [] });
const polygon = (pts: LatLng[]) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[...pts.map(toXY), toXY(pts[0])]] },
});
const rectCorners = (a: LatLng, b: LatLng): LatLng[] => [
  { lat: Math.max(a.lat, b.lat), lng: Math.min(a.lng, b.lng) },
  { lat: Math.max(a.lat, b.lat), lng: Math.max(a.lng, b.lng) },
  { lat: Math.min(a.lat, b.lat), lng: Math.max(a.lng, b.lng) },
  { lat: Math.min(a.lat, b.lat), lng: Math.min(a.lng, b.lng) },
];
