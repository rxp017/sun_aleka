import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DateTime } from 'luxon';
import { getCoordinateOffset, getShadowVector, getSolsticeEquinoxPaths } from '../utils/solarEngine.js';

export const GLARE_COLORS = { EXTREME_GLARE: '#ef4444', HIGH: '#f59e0b', MODERATE: '#fbbf24', LOW: '#10b981', DARK: '#3b82f6' };
function popup(title, detail) {
  const node = document.createElement('div');
  const strong = document.createElement('strong'); strong.textContent = title;
  const paragraph = document.createElement('p'); paragraph.textContent = detail;
  node.append(strong, paragraph); return node;
}
const pair = (point) => [point.lat, point.lon];

export default function SolarMap({ settings, routeResult, windows, hours, onPickLocation }) {
  const container = useRef(null); const mapRef = useRef(null); const layersRef = useRef(null);
  const callback = useRef(onPickLocation); callback.current = onPickLocation;
  const [tileWarning, setTileWarning] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);

  useEffect(() => {
    const map = L.map(container.current, { center: [17.385, 78.4867], zoom: 12, zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(map);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      className: 'dark-map-tiles', maxZoom: 19,
    }).addTo(map);
    tiles.on('tileerror', () => setTileWarning(true));
    tiles.on('tileload', () => setTileWarning(false));
    layersRef.current = L.layerGroup().addTo(map); mapRef.current = map;
    map.on('click', (event) => {
      if (!pickingRef.current) return;
      callback.current({ lat: event.latlng.lat, lon: ((event.latlng.lng + 540) % 360) - 180,
        label: `${event.latlng.lat.toFixed(5)}, ${(((event.latlng.lng + 540) % 360) - 180).toFixed(5)}` });
      pickingRef.current = false; setPicking(false);
    });
    const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(container.current);
    return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();
    const { location, mode, heading, zone, date, structures, selectedHour, travel } = settings;
    const marker = (place, color, title) => L.circleMarker(pair(place), { pane: 'markerPane', radius: 7, color: '#f8fafc', weight: 2,
      fillColor: color, fillOpacity: 1 }).bindPopup(popup(title, place.label)).addTo(layers);
    if (mode === 'travel') {
      if (travel.origin) marker(travel.origin, '#10b981', 'Origin');
      if (travel.destination) marker(travel.destination, '#ef4444', 'Destination');
      if (routeResult) {
        // Merge equal-color segments so long routes remain responsive.
        const groups = [];
        for (const point of routeResult.timeline) {
          const last = groups.at(-1);
          if (last?.level === point.glareLevel) last.points.push([point.endLatitude, point.endLongitude]);
          else groups.push({ level: point.glareLevel, point,
            points: [[point.latitude, point.longitude], [point.endLatitude, point.endLongitude]] });
        }
        groups.forEach(({ level, point, points }) => L.polyline(points, { color: GLARE_COLORS[level], weight: 5, opacity: 0.9 })
          .bindPopup(popup(level.replaceAll('_', ' '), `${DateTime.fromISO(point.timestamp).setZone(zone).toFormat('HH:mm')} ${zone} · ${point.side.replaceAll('_', ' ')} · Sun ${point.sunAltitude.toFixed(1)}°`)).addTo(layers));
        map.fitBounds(L.latLngBounds(routeResult.coordinates.map(([lon, lat]) => [lat, lon])), { padding: [35, 35], maxZoom: 16 });
      } else if (travel.origin && travel.destination) map.fitBounds(L.latLngBounds(pair(travel.origin), pair(travel.destination)), { padding: [45, 45], maxZoom: 14 });
      else map.setView(pair(travel.origin || location), 12);
      return;
    }
    marker(location, '#f59e0b', location.label);
    const ray = (azimuth, color, title, distance = 70) => {
      const tip = getCoordinateOffset(location.lat, location.lon, distance, azimuth);
      L.polyline([pair(location), pair(tip)], { color, weight: 2.5 }).bindPopup(popup(title, `Bearing ${azimuth.toFixed(0)}° clockwise from north`)).addTo(layers);
    };
    if (mode === 'property') {
      ray(heading, '#ec4899', 'Front facade', 55);
      const paths = getSolsticeEquinoxPaths(location.lat, location.lon, zone, Number(date.slice(0, 4)));
      Object.entries(paths).forEach(([label, events], index) => events.forEach((event) => ray(event.azimuth,
        ['#fbbf24', '#06b6d4', '#10b981', '#a78bfa'][index], `${label} ${event.event}`)));
    } else if (mode === 'photo') {
      windows.filter((w) => w.vector).forEach((w) => ray(w.vector.azimuth,
        w.label.includes('Blue') ? '#60a5fa' : '#f59e0b', w.label));
    } else if (mode === 'event') {
      const slot = hours.find((h) => h.hour === selectedHour);
      if (slot) structures.forEach((structure) => {
        const base = getCoordinateOffset(location.lat, location.lon, structure.distance, structure.bearing);
        L.circle(pair(base), { radius: structure.footprint / 2, color: structure.color, fillOpacity: 0.3, weight: 2 })
          .bindPopup(popup(structure.label, `${structure.height} m tall · ${structure.footprint} m wide`)).addTo(layers);
        const shadow = getShadowVector(slot.solar.altitude, slot.solar.azimuth, structure.height);
        if (!Number.isFinite(shadow.length)) return;
        const displayLength = Math.min(shadow.length, 250);
        const left = getCoordinateOffset(base.lat, base.lon, structure.footprint / 2, shadow.direction - 90);
        const right = getCoordinateOffset(base.lat, base.lon, structure.footprint / 2, shadow.direction + 90);
        const farRight = getCoordinateOffset(right.lat, right.lon, displayLength, shadow.direction);
        const farLeft = getCoordinateOffset(left.lat, left.lon, displayLength, shadow.direction);
        L.polygon([left, right, farRight, farLeft].map(pair), { color: structure.color, fillColor: structure.color, fillOpacity: 0.14, weight: 1, dashArray: '4 4' })
          .bindPopup(popup(`${structure.label} shadow`, `${shadow.length.toFixed(1)} m · ${shadow.direction.toFixed(0)}°${shadow.length > 250 ? ' · Map drawing capped at 250 m' : ''}`)).addTo(layers);
      });
    }
    map.setView(pair(location), mode === 'event' ? 17 : 16);
  }, [settings, routeResult, windows, hours]);

  return <div className="solar-map-wrap">
    <div ref={container} className={`map-container ${picking ? 'map-picking' : ''}`} aria-label="Interactive solar map" />
    {settings.mode !== 'travel' && <button className={`map-pick-button ${picking ? 'selected' : ''}`} type="button"
      aria-pressed={picking} onClick={() => { pickingRef.current = !picking; setPicking(!picking); }}>
      {picking ? 'Click map to set location · Cancel' : '⌖ Pick location on map'}
    </button>}
    {tileWarning && <div className="map-warning" role="status">Map tiles unavailable. Calculations and overlays still work.</div>}
  </div>;
}
