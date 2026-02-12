// Fog of War Grid Engine
// Divides the world into ~50m cells and tracks which ones are explored.

const CELL_SIZE_METERS = 50;
const METERS_PER_DEG_LAT = 111_320;
const STORAGE_KEY = 'uncover_explored_cells';
const REVEAL_RADIUS = 2; // cells around user to reveal (2 cells = ~100m radius)

// Convert meters to degrees latitude
const CELL_SIZE_LAT = CELL_SIZE_METERS / METERS_PER_DEG_LAT;

// Convert meters to degrees longitude (varies with latitude)
function cellSizeLng(lat) {
  return CELL_SIZE_METERS / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
}

// Get the grid cell key for a lat/lng position
export function getCellKey(lat, lng) {
  const cellLat = Math.floor(lat / CELL_SIZE_LAT) * CELL_SIZE_LAT;
  const cLng = cellSizeLng(lat);
  const cellLng = Math.floor(lng / cLng) * cLng;
  // Round to avoid floating point noise
  return `${cellLat.toFixed(6)}_${cellLng.toFixed(6)}`;
}

// Get the bounding box for a cell key
export function getCellBounds(key) {
  const [latStr, lngStr] = key.split('_');
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  const cLng = cellSizeLng(lat);
  return {
    south: lat,
    north: lat + CELL_SIZE_LAT,
    west: lng,
    east: lng + cLng,
  };
}

// Get all cell keys that should be revealed around a position
export function getRevealCells(lat, lng) {
  const cells = [];
  const cLng = cellSizeLng(lat);
  for (let dy = -REVEAL_RADIUS; dy <= REVEAL_RADIUS; dy++) {
    for (let dx = -REVEAL_RADIUS; dx <= REVEAL_RADIUS; dx++) {
      // Circular reveal
      if (dx * dx + dy * dy <= REVEAL_RADIUS * REVEAL_RADIUS + 1) {
        const cellLat = lat + dy * CELL_SIZE_LAT;
        const cellLng = lng + dx * cLng;
        cells.push(getCellKey(cellLat, cellLng));
      }
    }
  }
  return cells;
}

// Load explored cells from localStorage
export function loadExploredCells() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? new Set(JSON.parse(data)) : new Set();
  } catch {
    return new Set();
  }
}

// Save explored cells to localStorage
export function saveExploredCells(cells) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cells]));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

// Reveal cells around a position, returns true if any new cells were added
export function revealAt(lat, lng, exploredCells) {
  const newCells = getRevealCells(lat, lng);
  let changed = false;
  for (const key of newCells) {
    if (!exploredCells.has(key)) {
      exploredCells.add(key);
      changed = true;
    }
  }
  if (changed) {
    saveExploredCells(exploredCells);
  }
  return changed;
}

// Estimate coverage: explored cells vs total cells in a bounding area
export function getCoverage(exploredCells, centerLat, centerLng, radiusMeters = 1000) {
  const latRange = radiusMeters / METERS_PER_DEG_LAT;
  const lngRange = radiusMeters / (METERS_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180));

  let totalCells = 0;
  const cLng = cellSizeLng(centerLat);

  const latSteps = Math.ceil((latRange * 2) / CELL_SIZE_LAT);
  const lngSteps = Math.ceil((lngRange * 2) / cLng);
  totalCells = latSteps * lngSteps;

  if (totalCells === 0) return 0;

  let exploredInArea = 0;
  for (const key of exploredCells) {
    const [latStr, lngStr] = key.split('_');
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (
      lat >= centerLat - latRange &&
      lat <= centerLat + latRange &&
      lng >= centerLng - lngRange &&
      lng <= centerLng + lngRange
    ) {
      exploredInArea++;
    }
  }

  return Math.min(100, Math.round((exploredInArea / totalCells) * 100));
}

export { CELL_SIZE_LAT, cellSizeLng };
