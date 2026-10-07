import { DateTime } from 'luxon';
import SunCalc from 'suncalc';

const DEG = Math.PI / 180;
export const normalise360 = (angle) => ((angle % 360) + 360) % 360;
const signedAngle = (angle) => normalise360(angle + 180) - 180;

export function isValidLocation(location) {
  return Boolean(location && Number.isFinite(location.lat) && Number.isFinite(location.lon)
    && Math.abs(location.lat) <= 90 && Math.abs(location.lon) <= 180);
}

function assertLocation(location) {
  if (!isValidLocation(location)) throw new Error('Latitude must be −90 to 90; longitude must be −180 to 180.');
}

export function parseCoordinates(text) {
  const match = text.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const place = { lat: Number(match[1]), lon: Number(match[2]), label: text.trim() };
  return isValidLocation(place) ? place : null;
}

const coordinatePair = (point) => Array.isArray(point)
  ? { lon: point[0], lat: point[1] } : { lon: point.lon ?? point.lng, lat: point.lat };

export function haversineMeters(start, end) {
  const a = coordinatePair(start); const b = coordinatePair(end);
  assertLocation(a); assertLocation(b);
  const p = Math.sin((b.lat - a.lat) * DEG / 2) ** 2
    + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin((b.lon - a.lon) * DEG / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, p))));
}

export function calculateBearing(lat1, lon1, lat2, lon2) {
  const delta = (lon2 - lon1) * DEG;
  const y = Math.sin(delta) * Math.cos(lat2 * DEG);
  const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG)
    - Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos(delta);
  return normalise360(Math.atan2(y, x) / DEG);
}

// Public angles are degrees clockwise from north. SunCalc 1.9 uses radians internally.
export function getSunlitSide(vehicleBearing, sunAzimuth, sunAltitude, userFacing = 'FORWARD') {
  const relativeAngle = signedAngle(sunAzimuth - vehicleBearing);
  const daylight = sunAltitude > 0;
  const frontBack = Math.abs(relativeAngle) <= 30 || Math.abs(relativeAngle) >= 150;
  let side = frontBack ? 'FRONT_BACK' : relativeAngle > 0 ? 'RIGHT' : 'LEFT';
  if (userFacing === 'BACKWARD' && side !== 'FRONT_BACK') side = side === 'LEFT' ? 'RIGHT' : 'LEFT';
  const glareLevel = !daylight ? 'DARK' : sunAltitude < 8 ? 'EXTREME_GLARE'
    : sunAltitude < 22 ? 'HIGH' : sunAltitude < 50 ? 'MODERATE' : 'LOW';
  return { side: daylight ? side : 'NONE', daylight, glareLevel, relativeAngle,
    sunAzimuth: normalise360(sunAzimuth), sunAltitude,
    alert: daylight && sunAltitude < 8 ? 'EXTREME_GLARE' : null };
}

export function getSolarVector(dateTime, latitude, longitude) {
  assertLocation({ lat: latitude, lon: longitude });
  const date = DateTime.isDateTime(dateTime) ? dateTime.toJSDate() : new Date(dateTime);
  if (!Number.isFinite(date.getTime())) throw new Error('Select a valid date and time.');
  const position = SunCalc.getPosition(date, latitude, longitude);
  return { azimuth: normalise360(position.azimuth / DEG + 180), altitude: position.altitude / DEG };
}

export function processTravelRoute(coordinates, departureISO, durationSeconds, userFacing = 'FORWARD', segmentDurations) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw new Error('A route needs at least two coordinates.');
  const departure = DateTime.fromISO(departureISO, { setZone: true });
  if (!departure.isValid || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid departure or journey duration.');
  const segments = coordinates.slice(0, -1).map((point, index) => ({
    start: coordinatePair(point), end: coordinatePair(coordinates[index + 1]),
    distance: haversineMeters(point, coordinates[index + 1]), index,
  })).filter((segment) => segment.distance > 0);
  const totalDistance = segments.reduce((sum, segment) => sum + segment.distance, 0);
  if (!totalDistance) throw new Error('Choose two different locations.');
  const useAnnotations = Array.isArray(segmentDurations) && segmentDurations.length === coordinates.length - 1
    && segmentDurations.every((value) => Number.isFinite(value) && value >= 0);
  const annotationTotal = useAnnotations ? segments.reduce((sum, segment) => sum + segmentDurations[segment.index], 0) : 0;
  let elapsedSeconds = 0;
  const timeline = [];
  segments.forEach((segment, index) => {
    const weight = annotationTotal > 0 ? segmentDurations[segment.index] / annotationTotal : segment.distance / totalDistance;
    const allocated = index === segments.length - 1 ? Math.max(0, durationSeconds - elapsedSeconds) : durationSeconds * weight;
    const count = Math.max(1, Math.ceil(allocated / 120));
    const deltaLon = signedAngle(segment.end.lon - segment.start.lon);
    for (let part = 0; part < count; part += 1) {
      const interpolate = (fraction) => ({
        lat: segment.start.lat + (segment.end.lat - segment.start.lat) * fraction,
        lon: signedAngle(segment.start.lon + deltaLon * fraction),
      });
      const start = interpolate(part / count); const end = interpolate((part + 1) / count);
      const midpoint = interpolate((part + 0.5) / count);
      const seconds = allocated / count;
      const timestamp = departure.plus({ seconds: elapsedSeconds + seconds / 2 });
      const solar = getSolarVector(timestamp, midpoint.lat, midpoint.lon);
      const bearing = calculateBearing(start.lat, start.lon, end.lat, end.lon);
      timeline.push({ index: timeline.length, timestamp: timestamp.toISO(), elapsedSeconds,
        durationSeconds: seconds, latitude: start.lat, longitude: start.lon,
        endLatitude: end.lat, endLongitude: end.lon, bearing,
        ...getSunlitSide(bearing, solar.azimuth, solar.altitude, userFacing) });
      elapsedSeconds += seconds;
    }
  });
  return timeline;
}

export function summarizeRoute(timeline) {
  const weights = { LEFT: 0, RIGHT: 0 };
  let daylightSeconds = 0; let lowSunSeconds = 0; let frontBackSeconds = 0;
  for (const point of timeline) {
    if (point.daylight) daylightSeconds += point.durationSeconds;
    if (point.glareLevel === 'HIGH' || point.glareLevel === 'EXTREME_GLARE') lowSunSeconds += point.durationSeconds;
    if (point.daylight && point.side === 'FRONT_BACK') frontBackSeconds += point.durationSeconds;
    if (point.side === 'LEFT' || point.side === 'RIGHT') {
      weights[point.side] += point.durationSeconds * Math.cos(point.sunAltitude * DEG)
        * Math.abs(Math.sin(point.relativeAngle * DEG));
    }
  }
  const totalWeight = weights.LEFT + weights.RIGHT;
  const difference = totalWeight ? Math.abs(weights.LEFT - weights.RIGHT) / totalWeight : 0;
  return { recommendation: difference < 0.05 ? 'EITHER' : weights.LEFT > weights.RIGHT ? 'RIGHT' : 'LEFT',
    weights, daylightSeconds, lowSunSeconds, frontBackSeconds,
    balance: totalWeight ? Math.round(weights.LEFT / totalWeight * 100) : 50 };
}

export function getShadowVector(altitude, azimuth, objectHeight) {
  if (!Number.isFinite(altitude) || !Number.isFinite(azimuth) || !Number.isFinite(objectHeight) || objectHeight < 0) throw new Error('Invalid shadow parameters.');
  return { length: altitude <= 0 ? Infinity : objectHeight / Math.tan(altitude * DEG), direction: normalise360(azimuth + 180) };
}

export function getCoordinateOffset(lat, lon, distanceMeters, bearingDegrees) {
  assertLocation({ lat, lon });
  const delta = distanceMeters / 6371000; const bearing = bearingDegrees * DEG; const phi = lat * DEG;
  const nextPhi = Math.asin(Math.sin(phi) * Math.cos(delta) + Math.cos(phi) * Math.sin(delta) * Math.cos(bearing));
  const nextLon = lon * DEG + Math.atan2(Math.sin(bearing) * Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(nextPhi));
  return { lat: nextPhi / DEG, lon: signedAngle(nextLon / DEG) };
}

export function getDaylight(location, isoDate, zone) {
  assertLocation(location);
  const seed = DateTime.fromISO(`${isoDate}T12:00`, { zone });
  if (!seed.isValid) throw new Error('Select a valid date and timezone.');
  const times = SunCalc.getTimes(seed.toJSDate(), location.lat, location.lon);
  const converted = Object.fromEntries(Object.entries(times).map(([key, date]) => [key,
    Number.isFinite(date.getTime()) ? DateTime.fromJSDate(date, { zone }) : null]));
  const midday = getSolarVector(seed, location.lat, location.lon);
  const midnight = getSolarVector(seed.startOf('day'), location.lat, location.lon);
  const polar = !converted.sunrise && !converted.sunset
    ? midday.altitude > 0 && midnight.altitude > 0 ? 'Midnight sun' : midday.altitude <= 0 && midnight.altitude <= 0 ? 'Polar night' : 'No sunrise or sunset on this solar cycle'
    : null;
  return { ...converted, polar,
    daylightHours: converted.sunrise && converted.sunset ? converted.sunset.diff(converted.sunrise, 'hours').hours
      : polar === 'Midnight sun' ? 24 : polar === 'Polar night' ? 0 : null };
}

export function getPhotographyWindows(location, isoDate, zone) {
  const times = getDaylight(location, isoDate, zone);
  const definitions = [
    ['Dawn / Blue Hour', times.nauticalDawn, times.dawn, 'Nautical to civil twilight'],
    ['Morning Golden Hour', times.sunrise, times.goldenHourEnd, 'Warm, low-angle light'],
    ['Solar Noon', times.solarNoon?.minus({ minutes: 20 }), times.solarNoon?.plus({ minutes: 20 }), 'Shortest shadows'],
    ['Evening Golden Hour', times.goldenHour, times.sunset, 'Warm, low-angle light'],
    ['Dusk / Blue Hour', times.dusk, times.nauticalDusk, 'Civil to nautical twilight'],
  ];
  return definitions.map(([label, start, end, condition]) => ({ label, start: start ?? null, end: end ?? null, condition,
    vector: start && end ? getSolarVector(start.plus({ milliseconds: end.diff(start).toMillis() / 2 }), location.lat, location.lon) : null }));
}

export function evaluateBuilding(location, heading, zone, year) {
  const benchmarks = [ ['March Equinox', `${year}-03-20`], ['June Solstice', `${year}-06-21`],
    ['September Equinox', `${year}-09-22`], ['December Solstice', `${year}-12-21`] ];
  return ['Front facade', 'Right facade', 'Rear facade', 'Left facade'].map((name, index) => {
    const angle = normalise360(heading + index * 90);
    const totals = benchmarks.map(([season, date]) => {
      let morning = 0; let afternoon = 0; let amCount = 0; let pmCount = 0;
      for (let minutes = 0; minutes < 1440; minutes += 30) {
        const moment = DateTime.fromISO(date, { zone }).startOf('day').plus({ minutes });
        const solar = getSolarVector(moment, location.lat, location.lon);
        const incidence = solar.altitude > 0 ? Math.max(0, Math.cos(signedAngle(solar.azimuth - angle) * DEG)) * Math.cos(solar.altitude * DEG) : 0;
        if (moment.hour < 12) { morning += incidence; amCount += 1; }
        else { afternoon += incidence; pmCount += 1; }
      }
      return { name: season, morning: morning / amCount * 100, afternoon: afternoon / pmCount * 100 };
    });
    return { name, angle, totals };
  });
}

export function getSolsticeEquinoxPaths(lat, lon, zone = 'UTC', year = DateTime.now().year) {
  return Object.fromEntries([['June Solstice', '06-21'], ['December Solstice', '12-21'],
    ['March Equinox', '03-20'], ['September Equinox', '09-22']].map(([label, day]) => {
    const times = getDaylight({ lat, lon }, `${year}-${day}`, zone);
    return [label, ['sunrise', 'sunset'].filter((key) => times[key]).map((key) => ({
      event: key, ...getSolarVector(times[key], lat, lon), timestamp: times[key].toISO(),
    }))];
  }));
}
