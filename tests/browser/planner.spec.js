import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { defaultSettings, PLACES } from '../../src/utils/plans.js';

const fixture = { code: 'Ok', routes: [{ distance: 8200, duration: 1800,
  geometry: { coordinates: [[78.4867, 17.385], [78.487, 17.4], [78.491, 17.42], [78.4983, 17.4399]] },
  legs: [{ annotation: { duration: [600, 600, 600] } }] }] };
const settings = () => ({ ...defaultSettings(), zone: 'Asia/Kolkata', date: '2026-10-03',
  travel: { ...defaultSettings().travel, origin: PLACES[0], destination: PLACES[1], departure: '2026-10-03T08:00' } });
const contentOf = async (download) => fs.readFile(await download.path(), 'utf8');
async function download(page, button) {
  if (!await page.getByRole('button', { name: button, exact: true }).isVisible()) await page.getByText('Save or share', { exact: true }).click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: button, exact: true }).click();
  return pending;
}

async function expandTools(page) {
  for (const summary of await page.locator('details:not(.time-settings):not(.plan-actions) > summary').all()) {
    if (await summary.isVisible() && !await summary.evaluate((node) => node.parentElement.open)) await summary.click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((initial) => {
    if (!localStorage.getItem('helio_workspace_v2')) localStorage.setItem('helio_workspace_v2', JSON.stringify(initial));
  }, settings());
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPu8AAAAASUVORK5CYII=', 'base64') }));
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.route('https://photon.komoot.io/**', (route) => route.fulfill({ json: { features: [] } }));
  await page.route('https://router.project-osrm.org/**', (route) => route.fulfill({ json: fixture }));
});

test('all planners display their own results and maps without overflow or runtime errors', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message)); await page.goto('/'); await expandTools(page);
  for (const [tab, heading, label] of [['Travel', 'Your trip', 'Road route'], ['Home sunlight', 'Your place', 'Sun bearings'],
    ['Photo times', 'Your photo shoot', 'Sun bearings'], ['Outdoor shade', 'Your outdoor space', '15:00 shadows']]) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click(); await expandTools(page);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.locator('.map-mode-label')).toHaveText(label);
    await expect(page.locator('.leaflet-marker-pane path').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('device location updates the origin and site and device timezone can be restored', async ({ page, context }) => {
  await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
  await context.grantPermissions(['geolocation']);
  await page.goto('/'); await expandTools(page);
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByLabel('Origin', { exact: true })).toHaveValue('My location');
  await expect(page.getByRole('status').filter({ hasText: 'Location ready' })).toBeVisible();
  await page.getByRole('tab', { name: /Photo times/ }).click(); await expandTools(page);
  await expect(page.getByLabel('Site location', { exact: true })).toHaveValue('My location');
  await page.getByText('Time settings', { exact: true }).click(); await page.getByRole('button', { name: 'Use device timezone' }).click();
  expect(await page.getByLabel('Planning timezone').inputValue()).toBe(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
});

test('everyday activity windows export real calendar events and omit polar night', async ({ page }) => {
  await page.goto('/'); await expandTools(page);
  for (const activity of ['walk', 'garden', 'dry', 'picnic']) {
    await page.getByLabel('Activity', { exact: true }).selectOption(activity);
    const calendar = await contentOf(await download(page, 'Add activity to calendar'));
    expect(calendar).toContain('BEGIN:VEVENT'); expect(calendar).not.toContain('Invalid DateTime');
  }
  await page.getByRole('tab', { name: /Photo times/ }).click(); await expandTools(page);
  await page.getByLabel('Latitude', { exact: true }).fill('78.22');
  await page.getByLabel('Longitude', { exact: true }).fill('15.65');
  await page.getByRole('button', { name: 'Apply coordinates' }).click();
  await page.getByLabel('Planning date').fill('2026-12-21');
  await expect(page.getByRole('button', { name: 'Add activity to calendar' })).toBeDisabled();
});

test('seat direction, duration and departure comparisons recalculate without repeated routing', async ({ page }) => {
  let requests = 0; await page.route('https://router.project-osrm.org/**', (route) => { requests += 1; return route.fulfill({ json: fixture }); });
  await page.goto('/'); await expandTools(page); await page.getByRole('button', { name: 'Find my seat' }).click(); await expandTools(page);
  await expect(page.locator('.lcd-display > strong')).toHaveText('Left side');
  await expect(page.getByText('Compare departure times', { exact: true })).toBeVisible();
  await expect(page.locator('.comparison-option')).toHaveCount(5);
  await page.getByRole('switch', { name: 'Seat faces backward' }).click();
  await expect(page.locator('.lcd-display > strong')).toHaveText('Right side');
  await page.getByLabel('Journey duration override (minutes)').fill('60');
  await expect(page.locator('.lcd-readings')).toContainText('60 min');
  await page.getByRole('button', { name: 'Depart at 08:30 on 2026-10-03' }).click();
  await expect(page.getByLabel('Departure (Asia/Kolkata)')).toHaveValue('2026-10-03T08:30');
  expect(requests).toBe(1);
  const report = await contentOf(await download(page, 'Export CSV'));
  expect(report).toContain('Recommended side'); expect(report).toContain('+05:30'); expect(report).toContain('2026-10-03');
  await page.getByRole('button', { name: '⇄ Swap locations' }).click();
  await expect(page.locator('.lcd-display > strong')).toHaveText('Less sun. A better ride.');
  await page.getByText('Save or share', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled();
});

test('night travel reports either side rather than inventing a sunlight advantage', async ({ page }) => {
  await page.goto('/'); await expandTools(page); await page.getByLabel('Departure (Asia/Kolkata)').fill('2026-10-03T23:00');
  await page.getByRole('button', { name: 'Find my seat' }).click(); await expandTools(page);
  await expect(page.locator('.lcd-display > strong')).toHaveText('Either side');
  await expect(page.getByText('Sun below the horizon for this journey.')).toBeVisible();
});

test('direct coordinates and keyboard suggestions work offline; duplicate locations are rejected', async ({ page }) => {
  await page.goto('/'); await expandTools(page);
  await page.getByRole('combobox', { name: 'Origin', exact: true }).fill('0, 0');
  await page.getByRole('combobox', { name: 'Origin', exact: true }).press('Enter');
  await page.getByRole('combobox', { name: 'Destination', exact: true }).fill('0, 0');
  await page.getByRole('combobox', { name: 'Destination', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Find my seat' }).click(); await expandTools(page);
  await expect(page.getByRole('alert')).toContainText('at least 10 meters');
  await page.getByRole('combobox', { name: 'Origin', exact: true }).fill('91, 0');
  await expect(page.getByRole('button', { name: 'Find my seat' })).toBeDisabled();
});

test('online routing failure is visible and retry remains possible', async ({ page }) => {
  await page.route('https://router.project-osrm.org/**', (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/'); await expandTools(page); await page.getByRole('button', { name: 'Find my seat' }).click(); await expandTools(page);
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Find my seat' })).toBeEnabled();
});

test('saved plans restore parameters, survive reload and can be deleted', async ({ page }) => {
  await page.goto('/'); await expandTools(page); await page.getByRole('tab', { name: /Home sunlight/ }).click(); await expandTools(page);
  await page.getByLabel('Exact bearing (°)').fill('45'); await page.getByLabel('Exact bearing (°)').press('Tab');
  await page.getByText('Save or share', { exact: true }).click(); await page.getByRole('button', { name: 'Save plan', exact: true }).click();
  await page.getByLabel('Plan name').fill('East-facing property');
  await page.getByRole('dialog').getByRole('button', { name: 'Save plan', exact: true }).click();
  await page.getByRole('tab', { name: /Photo times/ }).click(); await expandTools(page); await page.reload();
  await expect(page.getByRole('tab', { name: /Photo times/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: /Saved plans 1/ }).click();
  await page.getByRole('button', { name: 'Open East-facing property' }).click();
  await expect(page.getByLabel('Exact bearing (°)')).toHaveValue('45');
  await page.getByRole('button', { name: /Saved plans 1/ }).click();
  await page.getByRole('button', { name: 'Delete East-facing property' }).click();
  await expect(page.getByText('No saved plans yet.', { exact: false })).toBeVisible();
});

test('photography exports contain real windows and valid calendar events', async ({ page }) => {
  await page.goto('/'); await expandTools(page); await page.getByRole('tab', { name: /Photo times/ }).click(); await expandTools(page);
  const report = await contentOf(await download(page, 'Export CSV'));
  expect(report).toContain('Morning Golden Hour'); expect(report).not.toContain('Invalid DateTime');
  const calendar = await contentOf(await download(page, 'Export shoot calendar'));
  expect(calendar).toContain('BEGIN:VCALENDAR'); expect((calendar.match(/BEGIN:VEVENT/g) || []).length).toBe(5);
  expect(calendar).toMatch(/DTSTART:\d{8}T\d{6}Z/);
});

test('property and shade reports export their current numeric settings', async ({ page }) => {
  await page.goto('/'); await expandTools(page); await page.getByRole('tab', { name: /Home sunlight/ }).click(); await expandTools(page);
  expect(await contentOf(await download(page, 'Export CSV'))).toContain('AM index %');
  await page.getByRole('tab', { name: /Outdoor shade/ }).click(); await expandTools(page);
  await page.getByLabel('Height (m)', { exact: true }).fill('8'); await page.getByLabel('Height (m)', { exact: true }).press('Tab');
  await expect(page.getByRole('rowheader', { name: /Stage canopy/ })).toContainText('8 m tall');
  const report = await contentOf(await download(page, 'Export CSV')); expect(report).toContain('"Stage canopy","8"');
  await page.getByRole('button', { name: 'Add structure', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Add structure', exact: true }).click();
  await expect(page.getByLabel('Structure', { exact: true })).toHaveValue(/.+/);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('rowheader')).toHaveCount(3);
});

test('shade hour remains within a narrowed timeline and invalid heights do not affect calculations', async ({ page }) => {
  await page.goto('/'); await expandTools(page); await page.getByRole('tab', { name: /Outdoor shade/ }).click(); await expandTools(page);
  await page.getByLabel(/Start hour/).press('End');
  await expect(page.getByLabel(/Map hour/)).toHaveValue('22');
  await page.getByLabel('Height (m)', { exact: true }).fill('-1'); await page.getByLabel('Height (m)', { exact: true }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Enter 0.1 to 100');
  await expect(page.getByRole('rowheader', { name: /Stage canopy/ })).toContainText('5 m tall');
});

test('coordinate updates apply to the map and daylight, including polar dates', async ({ page }) => {
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expandTools(page); await page.getByRole('tab', { name: /Photo times/ }).click(); await expandTools(page);
  await page.getByLabel('Latitude', { exact: true }).fill('89'); await page.getByLabel('Longitude', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply coordinates' }).click(); await page.getByLabel('Planning date', { exact: true }).fill('2026-06-21');
  await expect(page.locator('.daylight-duration')).toContainText('Midnight sun');
  await expect(page.locator('.lighting-list')).not.toContainText('Invalid');
  await page.getByLabel('Planning date', { exact: true }).fill('2026-12-21');
  await expect(page.locator('.daylight-duration')).toContainText('Polar night');
  expect(errors).toEqual([]);
});

test('timezone edits validate and keep a consistent context across planners', async ({ page }) => {
  await page.goto('/'); await expandTools(page); await page.getByText('Time settings', { exact: true }).click(); await page.getByLabel('Planning timezone').fill('Fake/Timezone'); await page.getByLabel('Planning timezone').press('Tab');
  await expect(page.getByRole('alert')).toContainText('IANA timezone');
  await expect(page.locator('.context-strip')).toContainText('Asia/Kolkata');
  await page.getByLabel('Planning timezone').fill('UTC'); await page.getByLabel('Planning timezone').press('Tab');
  await expect(page.locator('.context-strip')).toContainText('UTC+00:00');
  await page.getByRole('tab', { name: /Travel/ }).focus(); await page.getByRole('tab', { name: /Travel/ }).press('End');
  await expect(page.getByRole('tab', { name: /Outdoor shade/ })).toHaveAttribute('aria-selected', 'true');
});

test('denied geolocation leaves coordinate entry available', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } }); });
  await page.goto('/'); await expandTools(page); await page.getByRole('button', { name: 'Use my location for origin' }).click();
  await expect(page.getByText('Location access is blocked. Allow it in your browser, find your city, or type a place below.')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Origin', exact: true })).toBeEnabled();
});

test('corrupt storage cannot crash the initial page', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('helio_workspace_v2', '{broken'); localStorage.setItem('helio_location_history', '{}'); localStorage.setItem('helio_plans_v2', '[{}]'); });
  await page.goto('/'); await expandTools(page); await expect(page.getByRole('heading', { name: 'Sun Aleka', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Saved plans 0/ })).toBeVisible();
});

test('blocked storage warns while calculations and exports remain available', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Blocked', 'SecurityError'); }; });
  await page.goto('/'); await expandTools(page); await expect(page.getByText('Device storage is unavailable. Export reports or copy a plan link to keep your work.')).toBeVisible();
  await page.getByRole('tab', { name: /Photo times/ }).click(); await expandTools(page);
  expect(await contentOf(await download(page, 'Export CSV'))).toContain('Morning Golden Hour');
});

test('plan links restore settings and popup labels are rendered as text', async ({ page }) => {
  const shared = { ...settings(), mode: 'property', heading: 87, location: { lat: 17.4, lon: 78.5, label: '<img src=x onerror=alert(1)>' } };
  await page.goto(`/#plan=${encodeURIComponent(JSON.stringify(shared))}`); await expandTools(page);
  await expect(page.getByLabel('Exact bearing (°)')).toHaveValue('87');
  await page.locator('.leaflet-marker-pane path.leaflet-interactive').first().click();
  await expect(page.locator('.leaflet-popup-content')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.leaflet-popup-content img')).toHaveCount(0);
});

test('a copied plan link is complete and reopens the same planner', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.testCopiedPlan = text; } } }); });
  await page.goto('/'); await expandTools(page); await page.getByRole('tab', { name: /Outdoor shade/ }).click(); await expandTools(page);
  await page.getByText('Save or share', { exact: true }).click(); await page.getByRole('button', { name: 'Copy plan link', exact: true }).click();
  const link = await page.evaluate(() => window.testCopiedPlan); expect(link).toContain('#plan=');
  await page.goto(link); await expect(page.getByRole('heading', { name: 'Your outdoor space', exact: true })).toBeVisible();
});

test('simple view starts with the trip rather than technical controls or map requests', async ({ page }) => {
  let tiles = 0; await page.route('https://tile.openstreetmap.org/**', (route) => { tiles += 1; return route.abort(); });
  await page.goto('/?simple');
  await expect(page.getByRole('heading', { name: 'Your trip', exact: true })).toBeVisible();
  await expect(page.getByLabel('Journey duration override (minutes)')).not.toBeVisible();
  await expect(page.getByLabel('Planning timezone')).not.toBeVisible();
  await expect(page.getByLabel('Interactive solar map')).toHaveCount(0);
  expect(tiles).toBe(0);
  await page.getByRole('button', { name: 'Find my seat' }).click();
  await expect(page.locator('.lcd-display > strong')).toHaveText('Left side');
  await expect(page.locator('.comparison-option').first()).not.toBeVisible();
});

test('unavailable device location offers an explicit city fallback and applies its timezone', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, fail) => fail({ code: 2 }) } }));
  let lookups = 0;
  await page.route('https://ipapi.co/json/', (route) => { lookups += 1; return route.fulfill({ json: { city: 'London', region: 'England', country_name: 'UK', latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' } }); });
  await page.goto('/?simple');
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Location help' })).toBeVisible();
  expect(lookups).toBe(0);
  await page.getByRole('button', { name: 'Find my city instead', exact: true }).click();
  await expect(page.getByLabel('Origin', { exact: true })).toHaveValue('London, England, UK');
  await expect(page.getByRole('status').filter({ hasText: 'Approximate city:' })).toBeVisible();
  await page.getByText('Time settings', { exact: true }).click();
  await expect(page.getByLabel('Planning timezone')).toHaveValue('Europe/London');
  expect(lookups).toBe(1);
});

test('city provider failure keeps manual city selection usable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_ok, fail) => fail({ code: 1 }) } }));
  await page.route('https://ipapi.co/json/', (route) => route.fulfill({ status: 429, json: { error: true } }));
  await page.goto('/?simple');
  await page.getByRole('button', { name: 'Use my location', exact: true }).click();
  await page.getByRole('button', { name: 'Find my city instead', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('City lookup is unavailable');
  await page.getByLabel('Choose your city', { exact: true }).fill('Mumbai');
  await page.getByLabel('Choose your city', { exact: true }).press('Enter');
  await expect(page.getByLabel('Origin', { exact: true })).toHaveValue('Mumbai, Maharashtra, India');
  await expect(page.getByRole('region', { name: 'Location help' })).toHaveCount(0);
});
