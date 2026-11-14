import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Post } from '../../../use-cases/posts/post-schemas';
import type { Draft } from '../../../use-cases/posts/posts-store';
import type { LatLng } from '../../../domain/geo/geo-schemas';
import { ICON, MARKER, PIXEL, ZOOM, ZONE } from '../../../config-new/constants';

// Draws every post with MapLibre GPU layers (no DOM markers, no 2D canvas redraws).
//   red pixels + icons + zone thumbnails -> symbol layers
//   comments                             -> GPU text labels
//   zone images                          -> one pre-clipped image per zone (drawn once, then GPU)

const FONT = ['Noto Sans Bold'];
const T = ZOOM.AD_INFO_THRESHOLD;
const NONE = '__none__';
const GAP = 18; // px between a post and its comment bubble (includes bubble padding)

type AnyPost = Post; // the draft uses id 'draft'

export class GpuPosts {
  private images = new Map<string, Promise<HTMLImageElement>>();
  private zoneLayers = new Map<string, string>(); // zone id -> image url used
  private hovered: string | null = null;
  private version = 0;

  constructor(private map: MlMap, private onHoverZone: (id: string | null) => void) {}

  install() {
    const m = this.map;
    m.addImage('px-red', squareImage(PIXEL.SIZE, PIXEL.COLOR));
    const bg = labelBackground();
    m.addImage('label-bg', bg.data, bg.options);

    m.addSource('posts-zones', { type: 'geojson', data: fc([]) });
    m.addSource('posts-points', { type: 'geojson', data: fc([]) });

    // zone fill + border (zone images get inserted below these)
    m.addLayer({
      id: 'zones-fill-z', type: 'fill', source: 'posts-zones', minzoom: T,
      paint: { 'fill-color': ZONE.FILL_COLOR, 'fill-opacity': ZONE.FILL_OPACITY },
    });
    m.addLayer({
      id: 'zones-fill-hover', type: 'fill', source: 'posts-zones', maxzoom: T,
      filter: ['==', ['get', 'id'], NONE],
      paint: { 'fill-color': ZONE.FILL_COLOR, 'fill-opacity': ZONE.FILL_OPACITY },
    });
    m.addLayer({
      id: 'zones-line', type: 'line', source: 'posts-zones', filter: ['!', ['get', 'draft']],
      paint: { 'line-color': ZONE.BORDER_COLOR, 'line-width': ZONE.BORDER_WIDTH },
    });
    m.addLayer({
      id: 'zones-line-draft', type: 'line', source: 'posts-zones', filter: ['get', 'draft'],
      paint: { 'line-color': ZONE.BORDER_COLOR, 'line-width': ZONE.BORDER_WIDTH, 'line-dasharray': [3, 2] },
    });
    m.addLayer({
      id: 'zones-hit', type: 'fill', source: 'posts-zones', filter: ['!', ['get', 'draft']],
      paint: { 'fill-color': '#000', 'fill-opacity': 0.001 },
    });

    const iconSize: any = ICON.SCALE_WITH_ZOOM
      ? ['interpolate', ['exponential', 2], ['zoom'],
          ICON.REF_ZOOM - 4, ['max', ['get', 'sMin'], ['/', ['get', 's16'], 16]],
          ICON.REF_ZOOM, ['get', 's16']]
      : ['get', 's16'];

    const symbolBase = {
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    } as const;
    const opacity: any = ['case', ['get', 'draft'], 0.75, 1];

    m.addLayer({
      id: 'posts-pixels', type: 'symbol', source: 'posts-points',
      filter: ['==', ['get', 'type'], 'pixel'],
      layout: { ...symbolBase, 'icon-image': 'px-red' },
      paint: { 'icon-opacity': opacity },
    });
    m.addLayer({
      id: 'posts-icons', type: 'symbol', source: 'posts-points',
      filter: ['==', ['get', 'type'], 'icon'],
      layout: { ...symbolBase, 'icon-image': ['get', 'img'], 'icon-size': iconSize },
      paint: { 'icon-opacity': opacity },
    });

    // zone thumbnails: zoomed in, or hovered when zoomed out (same rule as the original app)
    const thumb = (id: string, extra: object, filter: any) =>
      m.addLayer({
        id, type: 'symbol', source: 'posts-points', filter, ...extra,
        layout: { ...symbolBase, 'icon-image': ['get', 'img'] },
        paint: { 'icon-opacity': opacity },
      });
    thumb('zone-thumbs-z', { minzoom: T }, ['==', ['get', 'type'], 'zthumb']);
    thumb('zone-thumbs-hover', { maxzoom: T }, ['all', ['==', ['get', 'type'], 'zthumb'], ['==', ['get', 'id'], NONE]]);

    // comments (GPU text in a white bubble)
    const label = (id: string, extra: object, filter: any, offset: any) =>
      m.addLayer({
        id, type: 'symbol', source: 'posts-points', filter, ...extra,
        layout: {
          'text-field': ['get', 'comment'],
          'text-font': FONT,
          'text-size': 12,
          'text-max-width': 16,
          'text-anchor': 'bottom',
          'symbol-z-order': 'source',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-image': 'label-bg',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [4, 8, 4, 8],
          'icon-anchor': 'bottom',
          'text-radial-offset': offset,
        } as any,
        paint: { 'text-color': '#111827', 'text-opacity': opacity, 'icon-opacity': opacity },
      });

    const iconOffset: any = ICON.SCALE_WITH_ZOOM
      ? ['interpolate', ['exponential', 2], ['zoom'], ICON.REF_ZOOM - 4, ['get', 'off12'], ICON.REF_ZOOM, ['get', 'off16']]
      : ['get', 'off16'];
    label('labels', {}, ['all', ['in', ['get', 'type'], ['literal', ['pixel', 'icon']]], ['!=', ['get', 'comment'], '']], iconOffset);
    label('zone-labels-z', { minzoom: T }, ['all', ['==', ['get', 'type'], 'zthumb'], ['!=', ['get', 'comment'], '']], ['get', 'off16']);
    label('zone-labels-hover', { maxzoom: T },
      ['all', ['==', ['get', 'type'], 'zthumb'], ['!=', ['get', 'comment'], ''], ['==', ['get', 'id'], NONE]], ['get', 'off16']);

    // hover on zones
    m.on('mousemove', 'zones-hit', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined;
      if (id && id !== this.hovered) this.onHoverZone(id);
    });
    m.on('mouseleave', 'zones-hit', () => this.onHoverZone(null));
  }

  setHovered(id: string | null) {
    this.hovered = id;
    const v = id ?? NONE;
    const m = this.map;
    m.setFilter('zones-fill-hover', ['==', ['get', 'id'], v]);
    m.setFilter('zone-thumbs-hover', ['all', ['==', ['get', 'type'], 'zthumb'], ['==', ['get', 'id'], v]]);
    m.setFilter('zone-labels-hover',
      ['all', ['==', ['get', 'type'], 'zthumb'], ['!=', ['get', 'comment'], ''], ['==', ['get', 'id'], v]]);
    // hide the zone's image while hovered so the outline + info show
    for (const zid of this.zoneLayers.keys()) {
      const layer = `zone-img-${zid}`;
      if (m.getLayer(layer)) m.setPaintProperty(layer, 'raster-opacity', zid === id ? 0 : zid === 'draft' ? 0.75 : 1);
    }
  }

  async update(posts: readonly Post[], draft: Draft) {
    const version = ++this.version;
    const list: AnyPost[] = [...posts];
    const d = draftAsPost(draft);
    if (d) list.push(d);

    // 1) make sure every image is loaded into the GPU
    const points: any[] = [];
    const zones: any[] = [];
    const zoneImages = new Map<string, { coords: LatLng[]; url: string }>();

    for (const p of list) {
      const isDraft = p.id === 'draft';
      if (p.kind === 'pixel') {
        points.push(point(p.at, { id: p.id, type: 'pixel', comment: p.comment, draft: isDraft,
          off16: (PIXEL.SIZE / 2 + GAP) / 12, off12: (PIXEL.SIZE / 2 + GAP) / 12 }));
      } else if (p.kind === 'icon') {
        if (!p.imageUrl) {
          points.push(point(p.at, { id: p.id, type: 'pixel', comment: p.comment, draft: isDraft, off16: (PIXEL.SIZE / 2 + GAP) / 12, off12: (PIXEL.SIZE / 2 + GAP) / 12 }));
          continue;
        }
        const img = await this.loadImage(p.imageUrl);
        if (version !== this.version) return;
        const key = `icon-${hash(p.imageUrl)}`;
        if (!this.map.hasImage(key)) this.map.addImage(key, img);
        const maxDim = Math.max(img.naturalWidth, img.naturalHeight);
        const h16 = (ICON.SIZE * img.naturalHeight) / maxDim;
        const s16 = ICON.SIZE / maxDim;
        const sMin = ICON.MIN_SIZE / maxDim;
        const h12 = Math.max(ICON.MIN_SIZE * (img.naturalHeight / maxDim), h16 / 16);
        points.push(point(p.at, { id: p.id, type: 'icon', img: key, comment: p.comment, draft: isDraft,
          s16, sMin, off16: (h16 / 2 + GAP) / 12, off12: (h12 / 2 + GAP) / 12 }));
      } else {
        zones.push({ type: 'Feature', properties: { id: p.id, draft: isDraft },
          geometry: { type: 'Polygon', coordinates: [[...p.coordinates.map(xy), xy(p.coordinates[0])]] } });
        if (p.imageUrl) {
          const img = await this.loadImage(p.imageUrl);
          if (version !== this.version) return;
          const key = `zthumb-${hash(p.imageUrl)}`;
          if (!this.map.hasImage(key)) this.map.addImage(key, thumbImage(img, MARKER.SIZE));
          points.push(point(center(p.coordinates), { id: p.id, type: 'zthumb', img: key, comment: p.comment,
            draft: isDraft, off16: (MARKER.SIZE / 2 + 3 + GAP) / 12 }));
          zoneImages.set(p.id, { coords: p.coordinates, url: p.imageUrl });
        }
      }
    }

    // 2) push the data to the GPU
    (this.map.getSource('posts-points') as GeoJSONSource).setData(fc(points));
    (this.map.getSource('posts-zones') as GeoJSONSource).setData(fc(zones));

    // 3) zone images: add new ones, remove old ones
    for (const [id, layerUrl] of this.zoneLayers) {
      const want = zoneImages.get(id);
      if (!want || want.url + JSON.stringify(want.coords) !== layerUrl) this.removeZoneImage(id);
    }
    for (const [id, z] of zoneImages) {
      if (this.zoneLayers.has(id)) continue;
      const img = await this.loadImage(z.url);
      if (version !== this.version) return;
      this.addZoneImage(id, z.coords, img, z.url + JSON.stringify(z.coords));
    }
    this.setHovered(this.hovered);
  }

  private addZoneImage(id: string, coords: LatLng[], img: HTMLImageElement, sig: string) {
    const clipped = clipToPolygon(img, coords);
    const src = `zone-src-${id}`;
    const layer = `zone-img-${id}`;
    this.map.addSource(src, { type: 'image', url: clipped.url, coordinates: clipped.corners });
    this.map.addLayer(
      { id: layer, type: 'raster', source: src, maxzoom: T,
        paint: { 'raster-opacity': id === 'draft' ? 0.75 : 1, 'raster-fade-duration': 0 } },
      'zones-fill-z'
    );
    this.zoneLayers.set(id, sig);
  }

  private removeZoneImage(id: string) {
    const layer = `zone-img-${id}`;
    const src = `zone-src-${id}`;
    if (this.map.getLayer(layer)) this.map.removeLayer(layer);
    if (this.map.getSource(src)) this.map.removeSource(src);
    this.zoneLayers.delete(id);
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    let p = this.images.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
      this.images.set(url, p);
    }
    return p;
  }
}

// ---------- helpers ----------

function draftAsPost(d: Draft): AnyPost | null {
  const base = { id: 'draft', comment: d.comment, createdAt: '' };
  if (d.kind === 'pixel' && d.at) return { ...base, kind: 'pixel', at: d.at };
  if (d.kind === 'icon' && d.at) return { ...base, kind: 'icon', at: d.at, imageUrl: d.imageUrl ?? '', paymentId: '' };
  if (d.kind === 'zone' && d.coordinates)
    return { ...base, kind: 'zone', coordinates: d.coordinates, imageUrl: d.imageUrl ?? '', paymentId: '' };
  return null;
}

const xy = (p: LatLng) => [p.lng, p.lat];
const fc = (features: any[]) => ({ type: 'FeatureCollection' as const, features });
const point = (at: LatLng, properties: object) => ({
  type: 'Feature', properties, geometry: { type: 'Point', coordinates: xy(at) },
});

function center(coords: LatLng[]): LatLng {
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  return { lat: (Math.max(...lats) + Math.min(...lats)) / 2, lng: (Math.max(...lngs) + Math.min(...lngs)) / 2 };
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += Math.max(1, Math.floor(s.length / 4000))) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${(h >>> 0).toString(36)}${s.length.toString(36)}`;
}

function squareImage(size: number, color: string): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = color;
  ctx.fillRect(1, 1, size - 2, size - 2);
  return ctx.getImageData(0, 0, size, size);
}

// white rounded bubble that stretches to fit the comment text
function labelBackground() {
  const s = 24;
  const r = 7;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, s - 1, s - 1, r);
  ctx.fill();
  ctx.stroke();
  return {
    data: ctx.getImageData(0, 0, s, s),
    options: { stretchX: [[r, s - r]] as [number, number][], stretchY: [[r, s - r]] as [number, number][], content: [r - 2, r - 2, s - r + 2, s - r + 2] as [number, number, number, number], pixelRatio: 1 },
  };
}

// square thumbnail with a white border, like the original zone marker
function thumbImage(img: HTMLImageElement, size: number): ImageData {
  const b = 3;
  const total = size + b * 2;
  const c = document.createElement('canvas');
  c.width = c.height = total;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(0, 0, total, total, 8);
  ctx.fill();
  const scale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b, b, size, size, 6);
  ctx.clip();
  ctx.drawImage(img, b + (size - w) / 2, b + (size - h) / 2, w, h);
  ctx.restore();
  return ctx.getImageData(0, 0, total, total);
}

// Draw the image stretched over the zone's bounding box and cut it to the zone shape, ONCE.
// The GPU then just shows the result as a flat image on the map.
function clipToPolygon(img: HTMLImageElement, coords: LatLng[]) {
  const mx = (lng: number) => (lng + 180) / 360;
  const my = (lat: number) => {
    const r = (lat * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  const west = Math.min(...coords.map((c) => c.lng));
  const east = Math.max(...coords.map((c) => c.lng));
  const north = Math.max(...coords.map((c) => c.lat));
  const south = Math.min(...coords.map((c) => c.lat));
  const wM = mx(east) - mx(west);
  const hM = my(south) - my(north);

  const maxPx = 1024;
  const W = wM >= hM ? maxPx : Math.max(1, Math.round((maxPx * wM) / hM));
  const H = hM > wM ? maxPx : Math.max(1, Math.round((maxPx * hM) / wM));

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  coords.forEach((p, i) => {
    const x = ((mx(p.lng) - mx(west)) / wM) * W;
    const y = ((my(p.lat) - my(north)) / hM) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, 0, 0, W, H);

  return {
    url: c.toDataURL('image/png'),
    corners: [[west, north], [east, north], [east, south], [west, south]] as [[number, number], [number, number], [number, number], [number, number]],
  };
}

