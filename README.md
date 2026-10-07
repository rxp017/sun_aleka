# Sun Aleka

A browser-based solar planner for road trips, property orientations, photography and outdoor events.

## Run

Requires Node.js 20.19+ or 22.12+ and npm.

```powershell
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open http://127.0.0.1:4173. For development, run `npm run dev`.

## Features

- Road journey seat recommendation, annotated route timing, reversible seat orientation, journey duration overrides and five departure comparisons.
- Property facade exposure on four seasonal reference dates. Frontage bearing and the planning year are editable.
- Golden/blue hour windows, daily sun altitude, sunrise/sunset and an importable shoot calendar.
- Editable outdoor structures with heights, widths and positions, hourly shadow matrices and map projections.
- Coordinate entry, map location picking, geolocation and online place search. Built-in city choices work without geocoding.
- Workspace persistence, up to 30 saved plans, shareable plan links and CSV reports for every mode.
- Keyboard tabs, search navigation, labeled forms, mobile layouts and reduced motion support.
- Device timezone detection and a one-button location setup for both the selected site and travel origin. First visits use already-granted location permission automatically; existing plans are preserved. Location permission remains optional.
- Everyday daylight windows for walking, gardening, drying laundry and picnics, with individual calendar exports. These are starting windows based on sun events, not weather or comfort predictions; polar dates omit unavailable windows.
- Taste-guided warm field-notebook UI with a bundled Outfit font, accessible controls and reduced motion.
- Simple task-first view: basic inputs and the main answer appear first. Exact coordinates, trip adjustments, seasonal tables, maps and exports are optional disclosures. New journeys start with blank locations.
- Location recovery handles blocked permissions, unavailable providers and embedded browsers that never call back. Manual city selection stays available. The optional "Find my city instead" action calls ipapi.co using the connection's public IP address; it estimates a city, never a precise position. It is not called automatically or when location permission is denied. VPNs and network routing can affect the estimate; verify the place before planning. Provider outages and limits fall back to city search.

## Model boundaries

All public solar angles are degrees clockwise from north; conversions from SunCalc 1.9 radians happen inside the engine. Shadow length assumes level ground. The facade index is relative vertical-wall incidence, not indoor temperature, heating demand or thermal load. Blue hour uses nautical/civil twilight boundaries. Polar dates show unavailable events rather than fabricated times.

Road geometry and travel times come from the public OSRM driving service. Bus time uses an explicit 28% adjustment unless a duration override is entered. It does not model bus schedules, live traffic or railway routes. Segment duration annotations are used when available, with distance allocation as a fallback. Low-sun colors are altitude categories; they do not measure glare, UV or heat. Clouds, terrain, obstructions and glass are not modeled.

Solar calculations run locally after the app loads. Map tiles (OpenStreetMap), road routing (OSRM) and location search (Photon) need internet access. Network errors are visible; a routing failure does not substitute a straight line for a road route. These public services have availability and rate limits; configure suitable providers before large-scale hosting.

Plans and search history stay in this browser. Plan links contain locations and settings in the URL fragment. Opening a link restores settings; travel plans require a fresh route. CSV exports guard against spreadsheet formula injection. Calendar timestamps use UTC and descriptions are escaped and folded according to RFC 5545.

## Verification

```powershell
npm run lint
npm test
npm run build
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.runtime\browsers'
$env:TEMP = Join-Path (Get-Location) '.runtime\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
npx playwright install chromium
npm run test:e2e -- --workers=2
```

Browser tests run against the production preview on port 4173. External routing/search/tile responses are deterministic test fixtures; they validate UI behavior and failure recovery, not upstream availability. Actual public-service checks are separate.

## Optional cloud copies

The core application needs no account or database. To enable optional magic-link sign-in and copies of future route calculations, copy `.env.example` to `.env.local` and set a Supabase URL and **publishable** key. Apply `supabase/schema.sql` to your own project, enable email sign-in and allow your preview/production URL in Auth redirect settings. Rebuild after changing environment variables.

No cloud credentials are supplied, and cloud sign-in/storage cannot be verified without a configured project. Saved plans remain local even when signed in. Never put service-role credentials in Vite environment variables.

## Files

`src/App.jsx` owns a single validated workspace and renders only the active planner. `src/utils/solarEngine.js` holds the calculations; `src/utils/plans.js` validates persistence and produces reports. `src/components/SolarMap.jsx` draws the active data with locally bundled Leaflet and text-only popups.
