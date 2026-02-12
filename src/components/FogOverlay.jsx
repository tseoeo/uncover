import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { getCellBounds } from '../lib/fogGrid';

// Custom Leaflet layer that renders fog of war as a canvas overlay
const FogCanvasLayer = L.Layer.extend({
  initialize(exploredCells) {
    this._exploredCells = exploredCells;
    this._canvas = null;
  },

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'fog-canvas');
    const pane = map.getPane('overlayPane');
    pane.appendChild(this._canvas);
    this._canvas.style.pointerEvents = 'none';
    this._canvas.style.position = 'absolute';
    this._canvas.style.zIndex = '400';

    map.on('move zoom viewreset resize', this._update, this);
    this._update();
  },

  onRemove(map) {
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    map.off('move zoom viewreset resize', this._update, this);
  },

  setExploredCells(cells) {
    this._exploredCells = cells;
    if (this._map) this._update();
  },

  _update() {
    if (!this._map || !this._canvas) return;

    const map = this._map;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;

    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;
    this._canvas.style.width = size.x + 'px';
    this._canvas.style.height = size.y + 'px';

    // Position canvas to cover the viewport
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);

    const ctx = this._canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Fill with dark fog
    ctx.fillStyle = 'rgba(10, 10, 10, 0.92)';
    ctx.fillRect(0, 0, size.x, size.y);

    // Cut out explored cells
    ctx.globalCompositeOperation = 'destination-out';

    const bounds = map.getBounds();
    const explored = this._exploredCells;

    for (const key of explored) {
      const cell = getCellBounds(key);

      // Skip cells outside viewport (with margin)
      if (
        cell.north < bounds.getSouth() - 0.005 ||
        cell.south > bounds.getNorth() + 0.005 ||
        cell.east < bounds.getWest() - 0.005 ||
        cell.west > bounds.getEast() + 0.005
      ) {
        continue;
      }

      const nw = map.latLngToContainerPoint([cell.north, cell.west]);
      const se = map.latLngToContainerPoint([cell.south, cell.east]);
      const w = se.x - nw.x;
      const h = se.y - nw.y;
      const cx = nw.x + w / 2;
      const cy = nw.y + h / 2;
      const r = Math.max(w, h) * 0.8;

      // Soft circular reveal per cell
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(0.7, 'rgba(0,0,0,1)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(nw.x - r, nw.y - r, r * 2 + w, r * 2 + h);
    }

    ctx.globalCompositeOperation = 'source-over';
  },
});

export default function FogOverlay({ exploredCells }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    const layer = new FogCanvasLayer(exploredCells);
    layer.addTo(map);
    layerRef.current = layer;

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.setExploredCells(exploredCells);
    }
  }, [exploredCells]);

  return null;
}
