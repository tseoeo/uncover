// Traces: user-generated notes anchored to locations

const STORAGE_KEY = 'uncover_traces';

let _traces = null;

function loadTraces() {
  if (_traces !== null) return _traces;
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    _traces = data ? JSON.parse(data) : [];
  } catch {
    _traces = [];
  }
  return _traces;
}

function saveTraces() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_traces));
  } catch {
    // silently fail
  }
}

export function getTraces() {
  return loadTraces();
}

export function addTrace(lat, lng, text, category = 'note') {
  const traces = loadTraces();
  const trace = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    lat,
    lng,
    text,
    category,
    createdAt: Date.now(),
  };
  traces.push(trace);
  saveTraces();
  return trace;
}

export function deleteTrace(id) {
  const traces = loadTraces();
  const idx = traces.findIndex(t => t.id === id);
  if (idx !== -1) {
    traces.splice(idx, 1);
    saveTraces();
  }
}

export const CATEGORIES = [
  { id: 'note', label: 'Note', icon: '✦' },
  { id: 'spot', label: 'Hidden Spot', icon: '◈' },
  { id: 'food', label: 'Food & Drink', icon: '↗' },
  { id: 'warning', label: 'Heads Up', icon: '!' },
  { id: 'history', label: 'History', icon: '∿' },
];
