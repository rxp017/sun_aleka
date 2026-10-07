import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceLocation, getNetworkLocation, locationMessage } from '../src/utils/location.js';

test('device location accepts zero coordinates and rejects malformed positions', async () => {
  const value = await getDeviceLocation({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 0, longitude: 0, accuracy: 50 } }) } });
  assert.equal(value.place.lat, 0); assert.equal(value.place.lon, 0);
  await assert.rejects(getDeviceLocation({ geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 91, longitude: 0 } }) } }), (error) => error.code === 2);
});
test('permission, unavailable providers and synchronous browser failures all terminate', async () => {
  await assert.rejects(getDeviceLocation({}), (error) => error.code === 2);
  await assert.rejects(getDeviceLocation({ geolocation: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } }), (error) => error.code === 1);
  await assert.rejects(getDeviceLocation({ geolocation: { getCurrentPosition: () => { throw new Error('Unavailable'); } } }), (error) => error.code === 2);
  assert.match(locationMessage({ code: 1 }), /blocked/);
});
test('a browser that never calls back cannot leave location loading forever', async () => {
  await assert.rejects(getDeviceLocation({ geolocation: { getCurrentPosition: () => {} } }, 1), (error) => error.code === 3);
});
test('network city lookup validates coordinates, timezone and provider errors', async () => {
  const value = await getNetworkLocation(async () => ({ ok: true, json: async () => ({ city: 'London', latitude: 51.5, longitude: -0.1, timezone: 'Europe/London' }) }));
  assert.equal(value.place.label, 'London'); assert.equal(value.zone, 'Europe/London');
  for (const data of [{ error: true }, { city: 'Fake', latitude: 99, longitude: 1 }, { city: 'Missing coordinates' }]) {
    await assert.rejects(getNetworkLocation(async () => ({ ok: true, json: async () => data })), /City lookup is unavailable/);
  }
  await assert.rejects(getNetworkLocation(async () => ({ ok: false })), /City lookup is unavailable/);
});
test('network city lookup aborts a stalled request', async () => {
  await assert.rejects(getNetworkLocation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }), 1), /timed out/);
});
