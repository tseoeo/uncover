import { useState, useEffect, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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
  const watchRef = useRef(null);
  const statusTimer = useRef(null);

  // Show a temporary status message
  const showStatus = useCallback((msg) => {
    setStatus(msg);
    clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), 3000);
  }, []);

  // Start watching location
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      showStatus('Geolocation not supported');
      return;
    }

    if (watchRef.current !== null) return;

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const newPos = [latitude, longitude];
        setUserPos(newPos);

        // Reveal fog of war
        setExplored(prev => {
          const copy = new Set(prev);
          const changed = revealAt(latitude, longitude, copy);
          if (changed) {
            return copy;
          }
          return prev;
        });
      },
      (err) => {
        console.warn('Geolocation error:', err);
        if (err.code === 1) {
          showStatus('Location access denied');
        } else {
          showStatus('Could not get location');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    );
  }, [showStatus]);

  // Stop watching
  const stopTracking = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  // Update coverage when explored changes
  useEffect(() => {
    if (userPos) {
      setCoverage(getCoverage(explored, userPos[0], userPos[1]));
    }
  }, [explored, userPos]);

  // Start tracking when entering map phase
  useEffect(() => {
    if (phase === 'map' && tracking) {
      startTracking();
    }
    return () => stopTracking();
  }, [phase, tracking, startTracking, stopTracking]);

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
          onClick={() => {
            localStorage.setItem('uncover_onboarded', '1');
            setPhase('map');
          }}
        >
          Start Exploring
        </button>
        <p className="note">
          Requires location access to reveal the map as you move.
        </p>
      </div>
    );
  }

  const mapCenter = userPos || DEFAULT_CENTER;

  const handleAddTrace = () => {
    if (!traceText.trim() || !userPos) return;
    const trace = addTrace(userPos[0], userPos[1], traceText.trim(), traceCategory);
    setTraces([...getTraces()]);
    setTraceText('');
    setShowTracePanel(false);
    showStatus('Trace left');
  };

  const handleCenterOnMe = () => {
    if (userPos) {
      setFlyTarget([...userPos]);
    } else {
      showStatus('Waiting for location...');
    }
  };

  const toggleTracking = () => {
    if (tracking) {
      stopTracking();
      setTracking(false);
      showStatus('Tracking paused');
    } else {
      setTracking(true);
      startTracking();
      showStatus('Tracking resumed');
    }
  };

  return (
    <div className="map-container">
      <MapContainer
        center={mapCenter}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        attributionControl={true}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        <FogOverlay exploredCells={explored} />

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
              className={`hud-btn ${tracking ? 'active' : ''}`}
              onClick={toggleTracking}
              title={tracking ? 'Pause tracking' : 'Resume tracking'}
            >
              {tracking ? '◉' : '○'}
            </button>
            <button
              className="hud-btn"
              onClick={() => {
                if (!userPos) {
                  showStatus('Waiting for location...');
                  return;
                }
                setShowTracePanel(true);
              }}
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
