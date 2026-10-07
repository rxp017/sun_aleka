import { DateTime } from 'luxon';
import { isValidLocation } from './solarEngine.js';

export const MODES = [
  { id: 'travel', title: 'Travel', code: '01', description: 'Find a seat with less sun.' },
  { id: 'property', title: 'Home sunlight', code: '02', description: 'See which side of your home gets less sun.' },
  { id: 'photo', title: 'Photo times', code: '03', description: 'Find the best times for your photos.' },
  { id: 'event', title: 'Outdoor shade', code: '04', description: 'See where the shade falls.' },
];
export const PLACES = [
  { label: 'Hyderabad, Telangana, India', lat: 17.385, lon: 78.4867 },
  { label: 'Secunderabad, Telangana, India', lat: 17.4399, lon: 78.4983 },
  { label: 'Mumbai, Maharashtra, India', lat: 19.076, lon: 72.8777 },
  { label: 'Bengaluru, Karnataka, India', lat: 12.9716, lon: 77.5946 },
  { label: 'New Delhi, India', lat: 28.6139, lon: 77.209 },
  { label: 'London, United Kingdom', lat: 51.5074, lon: -0.1278 },
  { label: 'New York, United States', lat: 40.7128, lon: -74.006 },
];
export const DEFAULT_STRUCTURES = [
  { id: 'stage', label: 'Stage canopy', height: 5, footprint: 14, bearing: 0, distance: 15, color: '#f43f5e' },
  { id: 'stalls', label: 'Vendor stalls', height: 2.6, footprint: 4, bearing: 90, distance: 12, color: '#06b6d4' },
  { id: 'seating', label: 'Seating rows', height: 1.1, footprint: 2, bearing: 180, distance: 12, color: '#10b981' },
];

export function defaultSettings() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  return { version: 2, mode: 'travel', zone, location: PLACES[0], date: DateTime.now().setZone(zone).toISODate(),
    heading: 135, startHour: 10, endHour: 18, selectedHour: 15, structures: DEFAULT_STRUCTURES,
    travel: { origin: null, destination: null, profile: 'car', backward: false,
      departure: DateTime.now().setZone(zone).plus({ minutes: 30 }).toFormat("yyyy-MM-dd'T'HH:mm"), durationMinutes: '' } };
}

const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const validPlace = (place) => isValidLocation(place) && typeof place.label === 'string' && place.label.length <= 250;
export function validSettings(value) {
  try {
    return Boolean(value && value.version === 2 && MODES.some((mode) => mode.id === value.mode)
      && typeof value.zone === 'string' && DateTime.now().setZone(value.zone).isValid
      && validPlace(value.location) && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && DateTime.fromISO(value.date).isValid
      && inRange(value.heading, 0, 359) && Number.isInteger(value.heading)
      && Number.isInteger(value.startHour) && inRange(value.startHour, 0, 22)
      && Number.isInteger(value.endHour) && inRange(value.endHour, value.startHour + 1, 23)
      && Number.isInteger(value.selectedHour) && inRange(value.selectedHour, value.startHour, value.endHour)
      && Array.isArray(value.structures) && value.structures.length > 0 && value.structures.length <= 8
      && new Set(value.structures.map((s) => s.id)).size === value.structures.length
      && value.structures.every((s) => typeof s.id === 'string' && s.id.length <= 80 && typeof s.label === 'string' && s.label.length <= 80
        && inRange(s.height, 0.1, 100) && inRange(s.footprint, 0.5, 100) && inRange(s.bearing, 0, 359)
        && inRange(s.distance, 0, 100) && /^#[0-9a-fA-F]{6}$/.test(s.color))
      && value.travel && (value.travel.origin === null || validPlace(value.travel.origin))
      && (value.travel.destination === null || validPlace(value.travel.destination))
      && ['car', 'bus'].includes(value.travel.profile) && typeof value.travel.backward === 'boolean'
      && typeof value.travel.departure === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.travel.departure)
      && DateTime.fromISO(value.travel.departure, { zone: value.zone }).isValid
      && (value.travel.durationMinutes === '' || inRange(Number(value.travel.durationMinutes), 1, 1440)));
  } catch { return false; }
}

export function readStorage(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
export function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function loadSettings() {
  try {
    if (window.location.hash.startsWith('#plan=')) {
      const hash = window.location.hash.slice(6);
      if (hash.length <= 12000) {
        const shared = JSON.parse(decodeURIComponent(hash));
        if (validSettings(shared)) return shared;
      }
    }
  } catch { /* Invalid links never replace a usable local workspace. */ }
  const saved = readStorage('helio_workspace_v2', null);
  return validSettings(saved) ? saved : defaultSettings();
}
export function loadPlans() {
  const saved = readStorage('helio_plans_v2', []);
  return Array.isArray(saved) ? saved.filter((plan) => typeof plan.id === 'string'
    && typeof plan.name === 'string' && plan.name.length <= 100 && typeof plan.createdAt === 'string'
    && validSettings(plan.settings)).slice(0, 30) : [];
}

export function createCSV(rows) {
  const escape = (value) => {
    let text = String(value ?? '');
    // Protect spreadsheet imports against formula injection in user-supplied labels.
    if (/^[=+@\-\t\r]/.test(text) && typeof value !== 'number') text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + rows.map((row) => row.map(escape).join(',')).join('\r\n');
}

export function createCalendar(windows, location) {
  const escape = (text) => String(text).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  const utc = (time) => time.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sun Aleka//Solar Planner//EN', 'CALSCALE:GREGORIAN'];
  windows.filter((w) => w.start?.isValid && w.end?.isValid && w.end > w.start).forEach((w, index) => {
    lines.push('BEGIN:VEVENT', `UID:${w.start.toMillis()}-${index}-${location.lat}-${location.lon}@sun_aleka.local`,
      `DTSTAMP:${utc(DateTime.now())}`, `DTSTART:${utc(w.start)}`, `DTEND:${utc(w.end)}`,
      `SUMMARY:${escape(w.label)}`, `LOCATION:${escape(location.label)}`,
      `DESCRIPTION:${escape(`${w.condition}. Astronomical estimate; check weather and obstructions.`)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  // RFC 5545 folding counts UTF-8 octets; continuation lines include one space.
  return lines.map((line) => {
    let result = ''; let width = 0;
    for (const character of line) {
      const size = new TextEncoder().encode(character).length;
      if (width + size > 75) { result += '\r\n '; width = 1; }
      result += character; width += size;
    }
    return result;
  }).join('\r\n') + '\r\n';
}

export function downloadFile(filename, content, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
