import { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

import FogOverlay from './components/FogOverlay';
import { loadExploredCells, revealAt, getCoverage } from './lib/fogGrid';
import { getTraces, addTrace, CATEGORIES } from './lib/traces';

// Default center (Sofia, Bulgaria — as per the product canvas)
const DEFAULT_CENTER = [42.6977, 23.3219];
const DEFAULT_ZOOM = 16;

// Dark map tiles (free, no API key)
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

// User location marker icon
const userIcon = L.divIcon({
  className: '',
  html: '<div class="user-dot"></div>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Trace marker icons by category
function traceIcon(category) {
  const cat = CATEGORIES.find(c => c.id === category) || CATEGORIES[0];
  return L.divIcon({
    className: '',
    html: `<div class="trace-marker">${cat.icon}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Component to fly map to a position
function FlyTo({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) {
      map.flyTo(position, map.getZoom(), { duration: 0.8 });
    }
  }, [position, map]);
  return null;
}

// Component to handle map taps for manual reveal
function MapTapHandler({ onTap }) {
  useMapEvents({
    click(e) {
      onTap(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

export default function App() {
  const [phase, setPhase] = useState(() => {
    return localStorage.getItem('uncover_onboarded') ? 'map' : 'onboard';
  });
  const [userPos, setUserPos] = useState(null);
  const [explored, setExplored] = useState(() => loadExploredCells());
  const [coverage, setCoverage] = useState(0);
  const [traces, setTraces] = useState(() => getTraces());
  const [showTracePanel, setShowTracePanel] = useState(false);
  const [traceText, setTraceText] = useState('');
  const [traceCategory, setTraceCategory] = useState('note');
  const [status, setStatus] = useState(null);
  const [flyTarget, setFlyTarget] = useState(null);
  const [tracking, setTracking] = useState(true);
  const [locationFailed, setLocationFailed] = useState(false);
  const [mapCenter] = useState(() => {
    // Use stored center if available, otherwise default
    const stored = localStorage.getItem('uncover_last_center');
    if (stored) {
      try { return JSON.parse(stored); } catch {}
    }
    return DEFAULT_CENTER;
  });
  const watchRef = useRef(null);
  const statusTimer = useRef(null);
  const hasInitialReveal = useRef(false);

  // Show a temporary status message
  const showStatus = useCallback((msg, duration = 3000) => {
    setStatus(msg);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), duration);
  }, []);

  // Reveal cells and update state
  const revealCells = useCallback((lat, lng) => {
    setExplored(prev => {
      const copy = new Set(prev);
      const changed = revealAt(lat, lng, copy);
      return changed ? copy : prev;
    });
  }, []);

  // Provide an initial reveal so the map isn't fully dark
  const doInitialReveal = useCallback((lat, lng) => {
    if (hasInitialReveal.current) return;
    hasInitialReveal.current = true;
    // Reveal a small cluster around the starting point
    const offsets = [
      [0, 0], [0.0002, 0], [-0.0002, 0], [0, 0.0003], [0, -0.0003],
      [0.0002, 0.0003], [-0.0002, 0.0003], [0.0002, -0.0003], [-0.0002, -0.0003],
    ];
    setExplored(prev => {
      const copy = new Set(prev);
      let changed = false;
      for (const [dlat, dlng] of offsets) {
        if (revealAt(lat + dlat, lng + dlng, copy)) changed = true;
      }
      return changed ? copy : prev;
    });
  }, []);

  // Start watching location
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      showStatus('Geolocation not supported — tap the map to explore');
      setLocationFailed(true);
      doInitialReveal(mapCenter[0], mapCenter[1]);
      return;
    }

    if (watchRef.current !== null) return;

    // Set a fallback timer — if no position arrives in 8s, show the map anyway
    const fallbackTimer = setTimeout(() => {
      if (!hasInitialReveal.current) {
        setLocationFailed(true);
        doInitialReveal(mapCenter[0], mapCenter[1]);
        showStatus('Could not get location — tap the map to explore', 5000);
      }
    }, 8000);

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        clearTimeout(fallbackTimer);
        setLocationFailed(false);
        const { latitude, longitude } = pos.coords;
        const newPos = [latitude, longitude];
        setUserPos(newPos);

        // Save for next session default
        localStorage.setItem('uncover_last_center', JSON.stringify(newPos));

        // Initial reveal + ongoing tracking
        if (!hasInitialReveal.current) {
          hasInitialReveal.current = true;
        }
        revealCells(latitude, longitude);
      },
      (err) => {
        clearTimeout(fallbackTimer);
        console.warn('Geolocation error:', err);
        setLocationFailed(true);
        doInitialReveal(mapCenter[0], mapCenter[1]);

        if (err.code === 1) {
          showStatus('Location denied — tap the map to explore', 5000);
        } else {
          showStatus('Location unavailable — tap the map to explore', 5000);
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );
  }, [showStatus, revealCells, doInitialReveal, mapCenter]);

  // Stop watching
  const stopTracking = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  // Handle tap-to-reveal on the map
  const handleMapTap = useCallback((lat, lng) => {
    revealCells(lat, lng);
  }, [revealCells]);

  // Update coverage when explored changes
  useEffect(() => {
    const center = userPos || mapCenter;
    setCoverage(getCoverage(explored, center[0], center[1]));
  }, [explored, userPos, mapCenter]);

  // Start watch-based tracking (for ongoing updates after initial permission)
  useEffect(() => {
    if (phase === 'map' && tracking && watchRef.current === null) {
      // On returning users (already onboarded), start tracking from useEffect.
      // For new users, tracking is started directly from the button tap handler.
      const alreadyOnboarded = localStorage.getItem('uncover_onboarded');
      if (alreadyOnboarded) {
        startTracking();
      }
    }
    return () => stopTracking();
  }, [phase, tracking, startTracking, stopTracking]);

  // Always do an initial reveal on first load if explored is empty
  useEffect(() => {
    if (phase === 'map' && explored.size === 0 && !hasInitialReveal.current) {
      doInitialReveal(mapCenter[0], mapCenter[1]);
    }
  }, [phase, explored, doInitialReveal, mapCenter]);

  // Handle the "Start Exploring" tap — request location DIRECTLY in the click handler
  // so iOS Safari shows the permission prompt (requires user gesture context)
  const handleStartExploring = () => {
    localStorage.setItem('uncover_onboarded', '1');

    if (navigator.geolocation) {
      // Fire getCurrentPosition synchronously in the tap handler — this is what
      // triggers the iOS permission prompt. watchPosition is started after.
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setUserPos([latitude, longitude]);
          localStorage.setItem('uncover_last_center', JSON.stringify([latitude, longitude]));
          hasInitialReveal.current = true;
          revealCells(latitude, longitude);
          setPhase('map');
          // Now start the continuous watch
          startTracking();
        },
        (err) => {
          console.warn('Initial geolocation error:', err);
          setLocationFailed(true);
          setPhase('map');
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    } else {
      setLocationFailed(true);
      setPhase('map');
    }
  };

  // Onboarding screen
  if (phase === 'onboard') {
    return (
      <div className="onboarding">
        <h1>Uncover</h1>
        <p className="subtitle">
          The collective memory of your neighborhood. Walk to reveal the map and discover what others have left behind.
        </p>
        <button
          className="onboarding-btn"
          onClick={handleStartExploring}
        >
          Start Exploring
        </button>
        <p className="note">
          Works best with location access. You can also tap the map to explore manually.
        </p>
      </div>
    );
  }

  const centerPos = userPos || mapCenter;

  const handleAddTrace = () => {
    if (!traceText.trim()) return;
    const pos = userPos || mapCenter;
    addTrace(pos[0], pos[1], traceText.trim(), traceCategory);
    setTraces([...getTraces()]);
    setTraceText('');
    setShowTracePanel(false);
    showStatus('Trace left');
  };

  const handleCenterOnMe = () => {
    if (userPos) {
      setFlyTarget([...userPos]);
    } else {
      showStatus('No location yet');
    }
  };

  const toggleTracking = () => {
    if (tracking) {
      stopTracking();
      setTracking(false);
      showStatus('Tracking paused');
    } else {
      setTracking(true);
      showStatus('Tracking resumed');
    }
  };

  return (
    <div className="map-container">
      <MapContainer
        center={centerPos}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        attributionControl={true}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <FogOverlay exploredCells={explored} />
        <MapTapHandler onTap={handleMapTap} />

        {flyTarget && <FlyTo position={flyTarget} />}

        {/* User location marker */}
        {userPos && (
          <Marker position={userPos} icon={userIcon} />
        )}

        {/* Trace markers */}
        {traces.map(trace => (
          <Marker
            key={trace.id}
            position={[trace.lat, trace.lng]}
            icon={traceIcon(trace.category)}
          >
            <Popup className="trace-popup" closeButton={false}>
              <div className="trace-popup-cat">
                {CATEGORIES.find(c => c.id === trace.category)?.label || 'Note'}
              </div>
              <div className="trace-popup-text">{trace.text}</div>
              <div className="trace-popup-time">{formatTime(trace.createdAt)}</div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      {/* Top HUD */}
      <div className="hud-top">
        <div className="hud-top-inner">
          <span className="app-title">Uncover</span>
          <span className="coverage-badge">{coverage}% explored</span>
        </div>
      </div>

      {/* Status message */}
      {status && (
        <div className="status-bar">
          <span className="status-msg">{status}</span>
        </div>
      )}

      {/* Bottom HUD */}
      {!showTracePanel && (
        <div className="hud-bottom">
          <div className="hud-bottom-inner">
            <button
              className={`hud-btn ${tracking && !locationFailed ? 'active' : ''}`}
              onClick={toggleTracking}
              title={tracking ? 'Pause tracking' : 'Resume tracking'}
            >
              {tracking && !locationFailed ? '◉' : '○'}
            </button>
            <button
              className="hud-btn"
              onClick={() => setShowTracePanel(true)}
              title="Leave a trace"
              style={{ width: 56, height: 56, fontSize: 24 }}
            >
              +
            </button>
            <button
              className="hud-btn"
              onClick={handleCenterOnMe}
              title="Center on me"
            >
              ◎
            </button>
          </div>
        </div>
      )}

      {/* Trace input panel */}
      {showTracePanel && (
        <div className="trace-panel">
          <h3>Leave a trace</h3>
          <div className="trace-categories">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                className={`trace-cat-btn ${traceCategory === cat.id ? 'active' : ''}`}
                onClick={() => setTraceCategory(cat.id)}
              >
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>
          <div className="trace-input-row">
            <input
              className="trace-input"
              type="text"
              placeholder="What did you notice here?"
              value={traceText}
              onChange={e => setTraceText(e.target.value)}
              maxLength={280}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddTrace();
                if (e.key === 'Escape') setShowTracePanel(false);
              }}
            />
            <button
              className="trace-submit"
              onClick={handleAddTrace}
              disabled={!traceText.trim()}
            >
              Drop
            </button>
          </div>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.4)',
              fontSize: 13,
              marginTop: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
            onClick={() => setShowTracePanel(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
