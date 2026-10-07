import test from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { calculateBearing, evaluateBuilding, getCoordinateOffset, getDaylight, getPhotographyWindows, getShadowVector,
  getSolarVector, getSolsticeEquinoxPaths, getSunlitSide, haversineMeters, isValidLocation, parseCoordinates,
  processTravelRoute, summarizeRoute } from '../src/utils/solarEngine.js';

const site = { lat: 17.385, lon: 78.4867 };
const approx = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('bearings follow north-clockwise degrees', () => {
  approx(calculateBearing(0, 0, 1, 0), 0); approx(calculateBearing(0, 0, 0, 1), 90);
  approx(calculateBearing(0, 0, -1, 0), 180); approx(calculateBearing(0, 0, 0, -1), 270);
});
test('small angles are degrees, with no ambiguous radian heuristic', () => {
  const sun = getSunlitSide(270, 5, 1); assert.equal(sun.side, 'RIGHT'); assert.equal(sun.sunAzimuth, 5);
  assert.equal(sun.sunAltitude, 1); assert.equal(sun.glareLevel, 'EXTREME_GLARE');
  assert.equal(getSunlitSide(270, 5, 1, 'BACKWARD').side, 'LEFT');
  assert.equal(getSunlitSide(0, 90, -1).side, 'NONE');
});
test('front/back sunlight and balanced nighttime do not invent a preferred side', () => {
  assert.equal(getSunlitSide(0, 0, 15).side, 'FRONT_BACK');
  const route = processTravelRoute([[78.4867, 17.385], [78.4983, 17.4399]], '2026-10-03T23:00:00+05:30', 1800);
  assert.equal(summarizeRoute(route).recommendation, 'EITHER');
  assert.equal(summarizeRoute(route).daylightSeconds, 0);
});
test('tiny road segments preserve exact total travel time and annotation ratios', () => {
  const coords = [[0, 0], [0.00001, 0], [0.00002, 0], [0.00002, 0], [0.00003, 0]];
  const timeline = processTravelRoute(coords, '2026-03-20T12:00:00Z', 0.3, 'FORWARD', [0.1, 0.1, 0, 0.1]);
  approx(timeline.reduce((sum, p) => sum + p.durationSeconds, 0), 0.3);
  assert.equal(timeline.length, 3); approx(timeline[0].durationSeconds, 0.1);
  assert.ok(timeline.every((p) => Number.isFinite(p.sunAltitude)));
});
test('road annotations allocate durations without distance bias', () => {
  const timeline = processTravelRoute([[0, 0], [1, 0], [2, 0]], '2026-03-20T12:00:00Z', 100, 'FORWARD', [1, 3]);
  approx(timeline[0].durationSeconds, 25); approx(timeline[1].durationSeconds, 75);
});
test('long route segments sample the changing sun and keep endpoints', () => {
  const timeline = processTravelRoute([[0, 0], [1, 0]], '2026-03-20T12:00:00Z', 3600);
  assert.equal(timeline.length, 30); approx(timeline.at(-1).endLongitude, 1);
  approx(timeline.reduce((sum, p) => sum + p.durationSeconds, 0), 3600);
});
test('route interpolation crosses the dateline by the short arc', () => {
  const timeline = processTravelRoute([[179, 0], [-179, 0]], '2026-03-20T12:00:00Z', 600);
  assert.ok(timeline.every((p) => Math.abs(p.longitude) >= 179));
});
test('invalid geometry, time and duration fail clearly', () => {
  assert.throws(() => processTravelRoute([[0, 91], [0, 0]], '2026-03-20T12:00:00Z', 100));
  assert.throws(() => processTravelRoute([[0, 0], [0, 0]], '2026-03-20T12:00:00Z', 100));
  assert.throws(() => processTravelRoute([[0, 0], [1, 0]], 'invalid', 100));
  assert.throws(() => processTravelRoute([[0, 0], [1, 0]], '2026-03-20T12:00:00Z', -1));
  assert.throws(() => getSolarVector('invalid', site.lat, site.lon));
});
test('shadow projection uses degrees and identifies the absent sun', () => {
  approx(getShadowVector(45, 90, 5).length, 5); assert.equal(getShadowVector(45, 90, 5).direction, 270);
  assert.equal(getShadowVector(-1, 0, 5).length, Infinity);
  assert.throws(() => getShadowVector(45, 90, -1));
});
test('spherical offsets remain valid at the pole', () => {
  const offset = getCoordinateOffset(90, 0, 30, 90); assert.ok(isValidLocation(offset));
  approx(haversineMeters({ lat: 0, lon: 0 }, getCoordinateOffset(0, 0, 100, 90)), 100, 0.01);
});
test('coordinate entry validates ranges and preserves zeros', () => {
  assert.equal(parseCoordinates('0, 0').lat, 0); assert.equal(parseCoordinates('-90, 180').lon, 180);
  assert.equal(parseCoordinates('91, 0'), null); assert.equal(parseCoordinates('abc'), null);
});
test('Hyderabad sun events fall on the selected local date and windows are ordered', () => {
  const day = getDaylight(site, '2026-10-03', 'Asia/Kolkata');
  assert.equal(day.sunrise.toISODate(), '2026-10-03'); assert.equal(day.sunset.toISODate(), '2026-10-03');
  assert.ok(day.daylightHours > 11 && day.daylightHours < 13);
  getPhotographyWindows(site, '2026-10-03', 'Asia/Kolkata').forEach((window) => assert.ok(window.start.isValid && window.end > window.start));
});
test('polar day and night return unavailable events without NaN windows', () => {
  const polarSite = { lat: 89, lon: 0 };
  assert.equal(getDaylight(polarSite, '2026-06-21', 'UTC').polar, 'Midnight sun');
  assert.equal(getDaylight(polarSite, '2026-12-21', 'UTC').polar, 'Polar night');
  const windows = getPhotographyWindows(polarSite, '2026-12-21', 'UTC');
  assert.equal(windows[0].start, null); assert.equal(windows[1].vector, null);
});
test('seasonal vectors honor the supplied year and zone', () => {
  const paths = getSolsticeEquinoxPaths(site.lat, site.lon, 'Asia/Kolkata', 2027);
  assert.ok(Object.values(paths).flat().every((point) => DateTime.fromISO(point.timestamp, { setZone: true }).year === 2027));
});
test('vertical wall indices stay in range and rotate with the frontage', () => {
  const first = evaluateBuilding(site, 0, 'Asia/Kolkata', 2026);
  const rotated = evaluateBuilding(site, 90, 'Asia/Kolkata', 2026);
  assert.deepEqual(first[1].totals, rotated[0].totals);
  assert.ok(first.flatMap((room) => room.totals).every((p) => p.morning >= 0 && p.morning <= 100 && p.afternoon >= 0 && p.afternoon <= 100));
});
