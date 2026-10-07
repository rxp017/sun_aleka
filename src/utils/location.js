import { DateTime } from 'luxon';
import { isValidLocation } from './solarEngine.js';

export function locationMessage(error) {
  if (error.code === 1) return 'Location access is blocked. Allow it in your browser, find your city, or type a place below.';
  if (error.code === 3) return 'Your browser took too long to find you. Find your city or type a place below.';
  return 'This browser could not get your position. Find your city or type a place below.';
}

export function getDeviceLocation(browser = navigator, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, position) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) { reject(error); return; }
      const place = { lat: position?.coords?.latitude, lon: position?.coords?.longitude, label: 'My location' };
      if (!isValidLocation(place)) { reject({ code: 2 }); return; }
      resolve({ place, accuracy: position.coords.accuracy });
    };
    // Embedded browsers can fail to call either callback. Always restore a usable UI.
    const timer = setTimeout(() => finish({ code: 3 }), timeoutMs + 500);
    try {
      if (!browser.geolocation || globalThis.isSecureContext === false) { finish({ code: 2 }); return; }
      browser.geolocation.getCurrentPosition((position) => finish(null, position), (error) => finish(error),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 });
    } catch { finish({ code: 2 }); }
  });
}

export async function getNetworkLocation(fetcher = fetch, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher('https://ipapi.co/json/', { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('City lookup is unavailable. Type your city instead.');
    const data = await response.json();
    const place = { lat: data.latitude, lon: data.longitude, label: [data.city, data.region, data.country_name].filter(Boolean).join(', ') };
    if (data.error || !isValidLocation(place) || !data.city || !place.label) throw new Error('City lookup is unavailable. Type your city instead.');
    return { place, zone: typeof data.timezone === 'string' && DateTime.now().setZone(data.timezone).isValid ? data.timezone : null };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('City lookup timed out. Type your city instead.');
    throw error;
  } finally { clearTimeout(timer); }
}
