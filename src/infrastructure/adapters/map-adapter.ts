import L from 'leaflet';
import 'leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface MapAdapter {
  initialize(containerId: string): void;
  onDrawStart(callback: () => void): void;
  onDrawComplete(callback: (coords: Array<{ lat: number; lng: number }>) => void): void;
  onDrawCancel(callback: () => void): void;
  onZoomChange(callback: (zoom: number) => void): void;
  onMove(callback: () => void): void;
  onHover(callback: () => void): void;
  onUnhover(callback: (relatedTarget: any) => void): void;
  getZoom(): number;
  getMapInstance(): L.Map;
  getCurrentLayer(): L.Layer | null;
}

export class LeafletAdapter implements MapAdapter {
  private map!: L.Map;
  private drawnItems!: L.FeatureGroup;
  private currentLayer: L.Layer | null = null;
  
  // Store callbacks to attach when layer is ready
  private hoverCallback: (() => void) | null = null;
  private unhoverCallback: ((relatedTarget: any) => void) | null = null;

  initialize(containerId: string): void {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container ${containerId} not found`);

    this.map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
    }).setView([34.0522, -118.2437], 13);

    // @ts-ignore
    L.maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/bright',
    }).addTo(this.map);

    this.drawnItems = new L.FeatureGroup().addTo(this.map);

    this.map.addControl(
      new L.Control.Draw({
        draw: {
          polygon: true as any,
          rectangle: true as any,
          marker: false,
          circle: false,
          polyline: false,
          circlemarker: false,
        },
        edit: {
          featureGroup: this.drawnItems,
        },
      } as any)
    );
  }

  onDrawStart(callback: () => void): void {
    this.map.on(L.Draw.Event.DRAWSTART, callback);
  }

  onDrawComplete(callback: (coords: Array<{ lat: number; lng: number }>) => void): void {
    this.map.on(L.Draw.Event.CREATED, (e: any) => {
      this.drawnItems.clearLayers();
      
      // HIDE LEAFLET RENDERING - canvas does all the drawing
      e.layer.setStyle({
        fillOpacity: 0.001,
        opacity: 0.001,
        fillColor: '#000000',
        color: '#000000',
      });
      
      this.drawnItems.addLayer(e.layer);
      this.currentLayer = e.layer;

      // NOW attach hover listeners if callbacks were registered
      if (this.hoverCallback) {
        this.currentLayer.on('mouseover', this.hoverCallback);
        console.log('🖱️ Hover listener attached to fence');
      }
      
      if (this.unhoverCallback) {
        this.currentLayer.on('mouseout', (e: any) => {
          this.unhoverCallback!(e.originalEvent?.relatedTarget);
        });
        console.log('🖱️ Unhover listener attached to fence');
      }

      const coords = e.layer.getLatLngs()[0].map((ll: L.LatLng) => ({
        lat: ll.lat,
        lng: ll.lng,
      }));

      callback(coords);
    });
  }

  onDrawCancel(callback: () => void): void {
    this.map.on(L.Draw.Event.DRAWSTOP, () => {
      if (!this.currentLayer) {
        callback();
      }
    });
  }

  onZoomChange(callback: (zoom: number) => void): void {
    this.map.on('zoomend', () => callback(this.map.getZoom()));
  }

  onMove(callback: () => void): void {
    this.map.on('move', callback);
  }

  onHover(callback: () => void): void {
    // Store callback to attach later when layer is created
    this.hoverCallback = callback;
    
    // If layer already exists, attach immediately
    if (this.currentLayer) {
      this.currentLayer.on('mouseover', callback);
      console.log('🖱️ Hover listener attached to existing fence');
    }
  }

  onUnhover(callback: (relatedTarget: any) => void): void {
    // Store callback to attach later when layer is created
    this.unhoverCallback = callback;
    
    // If layer already exists, attach immediately
    if (this.currentLayer) {
      this.currentLayer.on('mouseout', (e: any) => {
        callback(e.originalEvent?.relatedTarget);
      });
      console.log('🖱️ Unhover listener attached to existing fence');
    }
  }

  getZoom(): number {
    return this.map.getZoom();
  }

  getMapInstance(): L.Map {
    return this.map;
  }

  getCurrentLayer(): L.Layer | null {
    return this.currentLayer;
  }
}
