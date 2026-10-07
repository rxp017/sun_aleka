import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { BarElement, CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { DateTime } from 'luxon';
import SkeuomorphicCard from './components/SkeuomorphicCard.jsx';
import LocationSearch from './components/LocationSearch.jsx';
import SolarMap, { GLARE_COLORS } from './components/SolarMap.jsx';
import { getDeviceLocation, getNetworkLocation, locationMessage } from './utils/location.js';
import { cacheCalculation, isSupabaseConfigured, supabase } from './utils/supabaseClient.js';
import { evaluateBuilding, getDaylight, getPhotographyWindows, getShadowVector, getSolarVector,
  haversineMeters, processTravelRoute, summarizeRoute } from './utils/solarEngine.js';
import { createCalendar, createCSV, DEFAULT_STRUCTURES, downloadFile, loadPlans, loadSettings, MODES, validSettings, writeStorage } from './utils/plans.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Legend, Tooltip);
const clock = (time) => time?.isValid ? time.toFormat('HH:mm') : 'Unavailable';
const minutes = (seconds) => `${Math.round(seconds / 60)} min`;
const routeKey = (travel) => JSON.stringify([travel.origin?.lat, travel.origin?.lon, travel.destination?.lat, travel.destination?.lon]);
const formatSide = (side) => side === 'EITHER' ? 'Either side' : `${side === 'LEFT' ? 'Left' : 'Right'} side`;

function ActivityPlanner({ daylight, location }) {
  const [purpose, setPurpose] = useState('walk');
  const options = { walk: ['Outdoor walk', 'Morning daylight', daylight.sunrise, daylight.sunrise?.plus({ minutes: 45 }), 'First 45 minutes after sunrise; check weather and visibility.'],
    garden: ['Garden work', 'Morning garden session', daylight.sunrise?.plus({ minutes: 30 }), daylight.sunrise?.plus({ minutes: 90 }), 'Daylight session before solar noon. Temperature and shade depend on local conditions.'],
    dry: ['Drying laundry', 'Midday light', daylight.solarNoon?.minus({ hours: 1 }), daylight.solarNoon?.plus({ hours: 1 }), 'Light around solar noon. Drying also depends on humidity, rain and airflow.'],
    picnic: ['Picnic', 'Late-day picnic', daylight.sunset?.minus({ minutes: 90 }), daylight.sunset?.minus({ minutes: 30 }), 'A daylight window before sunset. Use Shade Planner to check your setup.'] };
  const [label, title, start, end, condition] = options[purpose];
  const available = !daylight.polar && start?.isValid && end?.isValid && start >= daylight.sunrise && end <= daylight.sunset;
  return <section className="activity-planner" aria-label="Everyday daylight planner"><div><span className="eyebrow">Beyond the journey</span><h2>Make daylight part of your day.</h2><p>Simple starting windows for everyday outdoor plans.</p></div>
    <div className="activity-controls"><label className="field"><span>Activity</span><select aria-label="Activity" className="inset-input" value={purpose} onChange={(event) => setPurpose(event.target.value)}>{Object.entries(options).map(([key, item]) => <option key={key} value={key}>{item[0]}</option>)}</select></label>
    <strong className="activity-time">{available ? `${clock(start)} – ${clock(end)}` : 'No suitable daylight window'}</strong><p>{condition}</p>
    <button className="secondary-button" type="button" disabled={!available} onClick={() => downloadFile(`sun_aleka-${purpose}.ics`, createCalendar([{ label: `${label}: ${title}`, start, end, condition }], location), 'text/calendar;charset=utf-8')}>Add activity to calendar</button></div></section>;
}

function NumberInput({ label, value, onCommit, min, max, step = 'any', suffix = '' }) {
  const [draft, setDraft] = useState(String(value)); const [error, setError] = useState('');
  useEffect(() => { setDraft(String(value)); setError(''); }, [value]);
  const commit = () => {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || number < min || number > max
      || (step === 1 && !Number.isInteger(number))) { setError(`Enter ${min} to ${max}${step === 1 ? ' (whole numbers)' : ''}.`); return; }
    setError(''); onCommit(number);
  };
  return <label className="field"><span>{label}{suffix && ` (${suffix})`}</span>
    <input className="inset-input" type="number" min={min} max={max} step={step} value={draft} aria-invalid={Boolean(error)}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    {error && <small className="field-error" role="alert">{error}</small>}
  </label>;
}

function Dialog({ open, title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { if (open) ref.current.showModal(); else ref.current.close(); }, [open]);
  return <dialog className="planner-dialog" ref={ref} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="dialog-header"><h2>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>
    {children}
  </dialog>;
}

function SiteControls({ settings, update }) {
  const [latitude, setLatitude] = useState(String(settings.location.lat));
  const [longitude, setLongitude] = useState(String(settings.location.lon));
  const [error, setError] = useState('');
  useEffect(() => { setLatitude(String(settings.location.lat)); setLongitude(String(settings.location.lon)); setError(''); }, [settings.location]);
  return <div className="control-stack">
    <LocationSearch label="Site location" value={settings.location} onSelect={(location) => update({ location })} />
    <details className="optional-controls"><summary>Enter exact coordinates</summary><form className="coordinate-form" onSubmit={(event) => {
      event.preventDefault();
      const lat = Number(latitude); const lon = Number(longitude);
      if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        setError('Enter valid coordinates: latitude −90 to 90, longitude −180 to 180.'); return;
      }
      update({ location: { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` } }); setError('');
    }}>
      <div className="coordinate-row">
        <label className="field"><span>Latitude</span><input className="inset-input" type="number" step="any" min="-90" max="90" required
          value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
        <label className="field"><span>Longitude</span><input className="inset-input" type="number" step="any" min="-180" max="180" required
          value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
      </div>
      <button type="submit" className="secondary-button">Apply coordinates</button>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form></details>
    <label className="field"><span>Planning date</span><input className="inset-input" type="date" value={settings.date} required
      onChange={(event) => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value) && DateTime.fromISO(event.target.value).isValid) update({ date: event.target.value }); }} /></label>
  </div>;
}

function TimelineChart({ timeline, zone }) {
  const data = useMemo(() => {
    const stride = Math.max(1, Math.ceil(timeline.length / 72)); const sampled = [];
    const ranks = { DARK: 0, LOW: 1, MODERATE: 2, HIGH: 3, EXTREME_GLARE: 4 };
    for (let index = 0; index < timeline.length; index += stride) {
      const group = timeline.slice(index, index + stride);
      const worst = group.reduce((a, b) => ranks[a.glareLevel] >= ranks[b.glareLevel] ? a : b);
      sampled.push({ ...worst, timestamp: group[0].timestamp, durationSeconds: group.reduce((sum, p) => sum + p.durationSeconds, 0) });
    }
    return { labels: ['Journey'], datasets: sampled.map((point) => ({
      label: DateTime.fromISO(point.timestamp).setZone(zone).toFormat('HH:mm'), data: [point.durationSeconds / 60],
      backgroundColor: GLARE_COLORS[point.glareLevel], borderWidth: 0, point,
    })) };
  }, [timeline, zone]);
  return <div className="timeline">
    <div className="timeline__legend">{Object.entries(GLARE_COLORS).map(([level, color]) => <div key={level}><span style={{ backgroundColor: color }} />{level.replaceAll('_', ' ')}</div>)}</div>
    <div className="timeline__canvas" role="img" aria-label="Route timeline colored by estimated low-sun exposure">
      <Bar data={data} options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y', animation: false,
        scales: { x: { stacked: true, ticks: { color: '#94a3b8', callback: (value) => `${Math.round(value)}m` }, grid: { color: '#ffffff0a' } }, y: { stacked: true, display: false } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => {
          const point = context.dataset.point;
          return `${point.side.replaceAll('_', ' ')} · ${point.glareLevel.replaceAll('_', ' ')} · ${point.sunAltitude.toFixed(1)}° altitude`;
        } } } } }} />
    </div>
    <p className="field-hint">Hover for time and exposure. Long timelines group samples and show the highest low-sun category in each group.</p>
  </div>;
}

function TravelPanel({ settings, updateTravel, result, loading, routeError, calculate, comparisons, applyDeparture }) {
  const { travel, zone } = settings;
  return <div className="mode-grid">
    <SkeuomorphicCard title="Your trip" className="controls-card"><div className="control-stack">
      <LocationSearch label="Origin" value={travel.origin} onSelect={(origin) => updateTravel({ origin })} allowClear />
      <LocationSearch label="Destination" value={travel.destination} onSelect={(destination) => updateTravel({ destination })} allowClear />
      <button className="secondary-button" type="button" disabled={loading} onClick={() => updateTravel({ origin: travel.destination, destination: travel.origin })}>⇄ Swap locations</button>
      <label className="field"><span>Departure ({zone})</span><input className="inset-input" type="datetime-local" required value={travel.departure}
        onChange={(event) => { if (event.target.value && DateTime.fromISO(event.target.value, { zone }).isValid) updateTravel({ departure: event.target.value }); }} /></label>
      <fieldset className="selector selector--two"><legend>Road travel profile</legend>{['car', 'bus'].map((profile) => <button key={profile} type="button"
        className={travel.profile === profile ? 'selected' : ''} aria-pressed={travel.profile === profile} onClick={() => updateTravel({ profile })}>{profile}</button>)}</fieldset>
      <details className="optional-controls"><summary>More trip options</summary><div className="control-stack"><label className="field"><span>Journey duration override (minutes)</span><input className="inset-input" type="number" min="1" max="1440" step="any"
        placeholder="Use estimated road duration" value={travel.durationMinutes} onChange={(event) => updateTravel({ durationMinutes: event.target.value })} />
        <small className="field-hint">Bus estimate adds 28% to road time. Enter your scheduled duration for a better estimate.</small></label>
      <div className="switch-row"><span id="backward-label">Seat faces backward</span><button className={`toggle ${travel.backward ? 'on' : ''}`}
        type="button" role="switch" aria-checked={travel.backward} aria-labelledby="backward-label" onClick={() => updateTravel({ backward: !travel.backward })}><span /></button></div></div></details>
      <button className="mechanical-button" type="button" disabled={loading || !travel.origin || !travel.destination} onClick={calculate}>
        {loading ? 'Finding your route…' : result ? 'Update my seat' : 'Find my seat'}</button>
      {routeError && <p className="field-error" role="alert">{routeError}</p>}
      <p className="microcopy">Uses an estimated road route. Buildings, clouds, tinted glass and traffic are not modeled. Left and right are relative to the direction you face.</p>
    </div></SkeuomorphicCard>
    <SkeuomorphicCard title="Your seat" tone="graphite" className={result ? '' : 'pending-result'}>
      <div className="lcd-display"><span className="lcd-label">Sit on this side</span>
        <strong>{result ? formatSide(result.recommendation) : 'Less sun. A better ride.'}</strong>
        <p>{result ? result.daylightSeconds === 0 ? 'Sun below the horizon for this journey.' : result.recommendation === 'EITHER'
          ? 'No meaningful difference in estimated side-window exposure.' : 'Lower estimated direct side-window exposure.' : 'Enter your starting point, destination and departure time.'}</p>
        {result && <div className="lcd-readings"><span>{(result.distance / 1000).toFixed(1)} km</span><span>{minutes(result.duration)}</span>
          <span>Arrival {clock(result.arrival)}</span></div>}
      </div>
      {result ? <>
        <details className="optional-controls"><summary>How much sun is on this trip?</summary><div className="metric-grid"><div><span>Daylight travel</span><strong>{minutes(result.daylightSeconds)}</strong></div>
          <div><span>Low-sun exposure</span><strong>{minutes(result.lowSunSeconds)}</strong></div>
          <div><span>Front / rear sun</span><strong>{minutes(result.frontBackSeconds)}</strong></div></div>
        <div className="exposure-balance"><span>LEFT {result.balance}%</span><div><i style={{ width: `${result.balance}%` }} /></div><span>RIGHT {100 - result.balance}%</span></div>
        <p className="field-hint">Share of modeled side-window exposure. This is a relative comparison, not a measured UV dose.</p>
        <TimelineChart timeline={result.timeline} zone={zone} /></details>
        <details className="optional-controls"><summary>Compare departure times</summary>
        <p className="field-hint">Same route and journey duration. Choose a time to recalculate instantly.</p>
        <div className="comparison-list">{comparisons.map((option) => <button key={option.offset} className={`comparison-option ${option.offset === 0 ? 'selected' : ''}`}
          type="button" onClick={() => applyDeparture(option.departure)} aria-label={`Depart at ${clock(option.departure)} on ${option.departure.toISODate()}`}>
          <time>{clock(option.departure)}</time><small>{option.departure.toFormat('dd MMM')} · {option.offset === 0 ? 'Current' : `${option.offset > 0 ? '+' : ''}${option.offset} min`}</small>
          <strong>{formatSide(option.recommendation)}</strong><span>{minutes(option.lowSunSeconds)} low sun</span>
        </button>)}</div></details>
        <details className="route-details"><summary>Inspect route samples</summary><div className="table-scroll"><table><thead><tr><th>Time ({zone})</th><th>Exposure side</th><th>Altitude</th><th>Low-sun category</th></tr></thead>
          <tbody>{result.timeline.filter((_, index) => index % Math.max(1, Math.ceil(result.timeline.length / 30)) === 0).map((point) => <tr key={point.index}>
            <td>{DateTime.fromISO(point.timestamp).setZone(zone).toFormat('HH:mm')}</td><td>{point.side.replaceAll('_', ' ')}</td><td>{point.sunAltitude.toFixed(1)}°</td><td>{point.glareLevel.replaceAll('_', ' ')}</td>
          </tr>)}</tbody></table></div></details>
      </> : <div className="empty-instrument"><span className="scanner" /><div className="empty-sun">☀</div><p>Your seat recommendation, route timeline<br />and departure comparison appear here.</p></div>}
    </SkeuomorphicCard>
  </div>;
}

function PropertyPanel({ settings, update, rooms }) {
  const leastExposed = rooms.toSorted((a, b) => a.totals.reduce((sum, p) => sum + p.morning + p.afternoon, 0) - b.totals.reduce((sum, p) => sum + p.morning + p.afternoon, 0))[0];
  return <div className="mode-grid">
    <SkeuomorphicCard title="Your place" className="controls-card"><SiteControls settings={settings} update={update} />
      <label className="field space-above"><span>Which way does the front wall face?</span><select className="inset-input" aria-label="Front wall direction" value={settings.heading} onChange={(event) => update({ heading: Number(event.target.value) })}>
        {[['North',0],['Northeast',45],['East',90],['Southeast',135],['South',180],['Southwest',225],['West',270],['Northwest',315]].map(([name,angle]) => <option key={angle} value={angle}>{name}</option>)}
        {settings.heading % 45 !== 0 && <option value={settings.heading}>{settings.heading}° (custom)</option>}
      </select></label>
      <details className="optional-controls"><summary>Set an exact direction</summary><NumberInput label="Exact bearing" min={0} max={359} step={1} value={settings.heading} onCommit={(heading) => update({ heading })} suffix="°" /></details>
      <p className="microcopy">Not sure? Use the compass on your phone while facing away from the front wall.</p>
    </SkeuomorphicCard>
    <SkeuomorphicCard title="Which wall gets less sun?" tone="graphite">
      <div className="insight-card"><span>LESS DIRECT SUN</span><strong>{leastExposed.name.replace('facade', 'wall')}</strong>
        <p>This wall gets less direct sun in our seasonal comparison. Nearby buildings and trees can change the result.</p></div>
      <details className="optional-controls"><summary>Compare the seasons</summary><div className="heatmap-grid">{rooms.map((room) => <article className="room-cell" key={room.name}>
        <div className="room-cell__heading"><strong>{room.name}</strong><small>{room.angle}°</small></div>
        {room.totals.map((period) => <div className="season-row" key={period.name}><span>{period.name.replace(' Equinox', '').replace(' Solstice', '')}</span>
          {[period.morning, period.afternoon].map((value, index) => <span key={index} className="heat-band" style={{ '--heat': `${value}%` }}
            title={`${index === 0 ? 'Morning' : 'Afternoon'} incidence ${value.toFixed(1)}%`}><small>{value.toFixed(0)}%</small></span>)}</div>)}
        <div className="heat-caption"><span>AM INDEX</span><span>PM INDEX</span></div>
      </article>)}</div>
      <p className="microcopy">Index = average direct incidence on a vertical wall over each half-day. It excludes terrain, nearby buildings, glazing and weather. It does not estimate heat load or indoor temperature.</p></details>
    </SkeuomorphicCard>
  </div>;
}

function PhotographyPanel({ settings, update, windows, daylight, sunPath, calendar }) {
  const golden = windows.find((w) => w.label === 'Morning Golden Hour' && w.start);
  return <div className="mode-grid">
    <SkeuomorphicCard title="Your photo shoot" className="controls-card"><SiteControls settings={settings} update={update} />
      <div className="solar-noon space-above"><span>Solar noon</span><strong>{clock(daylight.solarNoon)}</strong><small>Times shown in {settings.zone}</small></div>
      <button type="button" className="mechanical-button space-above" onClick={calendar}>Export shoot calendar</button>
      <p className="microcopy">Import the .ics file into your calendar. Events use UTC instants, so your calendar displays them in its own timezone.</p>
    </SkeuomorphicCard>
    <SkeuomorphicCard title="Best light for photos" tone="graphite">
      <div className="photo-clock"><span>{golden ? 'Morning Golden Hour' : 'Sunlight conditions'}</span><strong>{golden ? `${clock(golden.start)} – ${clock(golden.end)}` : daylight.polar || 'No morning golden hour'}</strong><i className="pulse-lamp" /></div>
      <div className="lighting-list">{windows.map((window) => <article key={window.label}>
        <div><strong>{window.label}</strong><small>{window.start ? window.condition : 'This solar event does not occur on this date'}</small></div>
        <time>{window.start && window.end ? `${clock(window.start)} – ${clock(window.end)}` : 'Unavailable'}</time>
        <div className="vector" style={{ '--vector': `${window.vector?.azimuth || 0}deg` }}><span /></div><em>{window.vector ? `${window.vector.azimuth.toFixed(0)}° N` : '—'}</em>
      </article>)}</div>
      <details className="optional-controls"><summary>See the sun through the day</summary><div className="sun-path-chart" role="img" aria-label="Sun altitude at half-hour intervals">
        <Line data={{ labels: sunPath.map((p) => p.time.toFormat('HH:mm')), datasets: [{ label: 'Sun altitude', data: sunPath.map((p) => p.altitude),
          borderColor: '#f59e0b', backgroundColor: '#f59e0b12', fill: true, pointRadius: 0, tension: 0.25 }] }}
          options={{ responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `${context.parsed.y.toFixed(1)}° altitude` } } },
            scales: { x: { ticks: { color: '#94a3b8', maxTicksLimit: 8 }, grid: { display: false } },
              y: { min: -90, max: 90, ticks: { color: '#94a3b8', callback: (value) => `${value}°` }, grid: { color: '#ffffff0a' } } } }} />
      </div><p className="microcopy">Astronomical estimates for an unobstructed horizon. Check clouds, terrain and local access before your shoot. Blue hour spans nautical and civil twilight.</p></details>
    </SkeuomorphicCard>
  </div>;
}

function EventPanel({ settings, update, hours }) {
  const [editing, setEditing] = useState(settings.structures[0].id);
  const structure = settings.structures.find((s) => s.id === editing) || settings.structures[0];
  const editStructure = (patch) => update({ structures: settings.structures.map((s) => s.id === structure.id ? { ...s, ...patch } : s) });
  const slot = hours.find((h) => h.hour === settings.selectedHour);
  return <div className="mode-grid">
    <SkeuomorphicCard title="Your outdoor space" className="controls-card"><SiteControls settings={settings} update={update} />
      <div className="control-stack space-above">
        <label className="field"><span>Start hour · {settings.startHour}:00</span><input type="range" min="0" max="22" value={settings.startHour}
          onChange={(event) => { const startHour = Number(event.target.value); const endHour = Math.max(settings.endHour, startHour + 1);
            update({ startHour, endHour, selectedHour: Math.min(endHour, Math.max(startHour, settings.selectedHour)) }); }} /></label>
        <label className="field"><span>End hour · {settings.endHour}:00</span><input type="range" min={settings.startHour + 1} max="23" value={settings.endHour}
          onChange={(event) => { const endHour = Number(event.target.value); update({ endHour, selectedHour: Math.min(endHour, settings.selectedHour) }); }} /></label>
        <label className="field"><span>Map hour · {settings.selectedHour}:00</span><input type="range" min={settings.startHour} max={settings.endHour} value={settings.selectedHour}
          onChange={(event) => update({ selectedHour: Number(event.target.value) })} /><output className="digital-mini">{settings.selectedHour}:00 · Sun {slot.solar.altitude.toFixed(1)}°</output></label>
      </div>
      <details className="structure-editor space-above"><summary>Change the objects casting shade</summary>
        <div className="field"><label htmlFor="structure-choice">Structure</label><select id="structure-choice" className="inset-input" value={structure.id} onChange={(event) => setEditing(event.target.value)}>
          {settings.structures.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
        <label className="field"><span>Name</span><input className="inset-input" value={structure.label} maxLength={80} onChange={(event) => editStructure({ label: event.target.value })} /></label>
        <div className="coordinate-row"><NumberInput label="Height" suffix="m" min={0.1} max={100} value={structure.height} onCommit={(height) => editStructure({ height })} />
          <NumberInput label="Width" suffix="m" min={0.5} max={100} value={structure.footprint} onCommit={(footprint) => editStructure({ footprint })} />
          <NumberInput label="Distance from site" suffix="m" min={0} max={100} value={structure.distance} onCommit={(distance) => editStructure({ distance })} />
          <NumberInput label="Position bearing" suffix="°" min={0} max={359} value={structure.bearing} onCommit={(bearing) => editStructure({ bearing })} /></div>
        <div className="button-row"><button className="secondary-button" type="button" disabled={settings.structures.length >= 8} onClick={() => {
          const added = { ...DEFAULT_STRUCTURES[0], id: crypto.randomUUID(), label: `Structure ${settings.structures.length + 1}` };
          update({ structures: [...settings.structures, added] }); setEditing(added.id);
        }}>Add structure</button><button className="secondary-button" type="button" disabled={settings.structures.length === 1}
          onClick={() => update({ structures: settings.structures.filter((s) => s.id !== structure.id) })}>Remove</button></div>
      </details>
    </SkeuomorphicCard>
    <SkeuomorphicCard title="Shade at your chosen time" tone="graphite">
      <div className="insight-card"><span>{slot.solar.altitude > 0 ? 'SELECTED HOUR' : 'SUN BELOW HORIZON'}</span><strong>{settings.selectedHour}:00 · {settings.zone}</strong>
        <p>{slot.solar.altitude > 0 ? `Shadow direction ${getShadowVector(slot.solar.altitude, slot.solar.azimuth, 1).direction.toFixed(0)}° clockwise from north.` : 'There is no direct sunlight to cast a solar shadow at this time.'}</p></div>
      <div className="shadow-summary">{settings.structures.map((structure) => { const shadow = getShadowVector(slot.solar.altitude, slot.solar.azimuth, structure.height); return <div key={structure.id}><span>{structure.label}</span><strong>{Number.isFinite(shadow.length) ? shadow.length.toFixed(1) + ' m shadow' : 'No sunlight'}</strong></div>; })}</div>
      <details className="optional-controls"><summary>See hourly shadow lengths</summary><div className="shade-table"><table><thead><tr><th>Structure</th>{hours.map((hour) => <th key={hour.hour}><button type="button" className={settings.selectedHour === hour.hour ? 'selected-hour' : ''}
        onClick={() => update({ selectedHour: hour.hour })} aria-label={`Show ${hour.hour}:00 on map`}>{hour.hour}:00</button></th>)}</tr></thead>
        <tbody>{settings.structures.map((s) => <tr key={s.id}><th scope="row">{s.label || 'Unnamed structure'}<small>{s.height} m tall · {s.footprint} m wide</small></th>
          {hours.map((hour) => { const shadow = getShadowVector(hour.solar.altitude, hour.solar.azimuth, s.height); return <td key={hour.hour}
            className={settings.selectedHour === hour.hour ? 'active-shadow-cell' : ''}><strong>{Number.isFinite(shadow.length) ? `${shadow.length.toFixed(1)} m` : 'No sun'}</strong><small>{Number.isFinite(shadow.length) ? `${shadow.direction.toFixed(0)}°` : '—'}</small></td>; })}
        </tr>)}</tbody></table></div>
      <p className="microcopy">Shadow reach is height ÷ tan(sun altitude). Map overlays approximate projections on level ground; drawings cap reach at 250 m. Width controls the drawing, not a verified shade coverage percentage.</p></details>
    </SkeuomorphicCard>
  </div>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [zoneDraft, setZoneDraft] = useState(settings.zone);
  const [zoneError, setZoneError] = useState('');
  const [plans, setPlans] = useState(loadPlans); const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false); const [planName, setPlanName] = useState('');
  const [notice, setNotice] = useState(''); const [storageWarning, setStorageWarning] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(''); const [mapOpen, setMapOpen] = useState(false);
  const initialWorkspace = useRef((() => { try { return Boolean(localStorage.getItem('helio_workspace_v2') || window.location.hash.startsWith('#plan=')); } catch { return false; } })());
  const [rawRoute, setRawRoute] = useState(null); const [loading, setLoading] = useState(false); const [routeError, setRouteError] = useState('');
  const requestRef = useRef(null); const tabRefs = useRef([]);
  const [user, setUser] = useState(null); const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState(''); const [authBusy, setAuthBusy] = useState(false); const [authMessage, setAuthMessage] = useState('');
  const update = useCallback((patch) => setSettings((old) => ({ ...old, ...patch })), []);
  const updateTravel = useCallback((patch) => setSettings((old) => ({ ...old, travel: { ...old.travel, ...patch } })), []);
  const useDeviceZone = () => update({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
  const locate = useCallback(async () => {
    setLocating(true); setLocationError('');
    try {
      const { place, accuracy } = await getDeviceLocation();
      const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      setSettings((old) => ({ ...old, zone: deviceZone, location: place, travel: { ...old.travel, origin: place } }));
      setNotice(Number.isFinite(accuracy) ? 'Location ready (accuracy about ' + Math.round(accuracy) + ' m).' : 'Location ready.');
    } catch (error) { setLocationError(locationMessage(error)); }
    finally { setLocating(false); }
  }, []);
  const findCity = async () => {
    setLocating(true); setLocationError('');
    try {
      const { place, zone: cityZone } = await getNetworkLocation();
      setSettings((old) => ({ ...old, zone: cityZone || old.zone, location: place, travel: { ...old.travel, origin: place } }));
      setNotice('Approximate city: ' + place.label + '. Check this location before planning.');
    } catch (error) { setLocationError(error.message || 'City lookup failed. Type your city below.'); }
    finally { setLocating(false); }
  };
  useEffect(() => {
    if (initialWorkspace.current || !navigator.permissions) return;
    let cancelled = false;
    navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (!cancelled && permission.state === 'granted') locate();
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [locate]);
  const { mode, zone, location, date, travel } = settings;
  const active = MODES.find((item) => item.id === mode);
  const key = routeKey(travel);
  const departing = useMemo(() => DateTime.fromISO(travel.departure, { zone }), [travel.departure, zone]);
  const mapLocation = mode === 'travel' ? travel.origin || location : location;
  const mapDate = mode === 'travel' ? departing.toISODate() : date;
  const daylight = useMemo(() => getDaylight(mapLocation, mapDate, zone), [mapLocation, mapDate, zone]);
  const windows = useMemo(() => mode === 'photo' ? getPhotographyWindows(location, date, zone) : [], [mode, location, date, zone]);
  const planningYear = Number(date.slice(0, 4));
  const rooms = useMemo(() => mode === 'property' ? evaluateBuilding(location, settings.heading, zone, planningYear) : [], [mode, location, settings.heading, zone, planningYear]);
  const hours = useMemo(() => mode === 'event' ? Array.from({ length: settings.endHour - settings.startHour + 1 }, (_, index) => {
    const hour = settings.startHour + index;
    const time = DateTime.fromISO(`${date}T${String(hour).padStart(2, '0')}:00`, { zone });
    return { hour, time, solar: getSolarVector(time, location.lat, location.lon) };
  }) : [], [mode, settings.endHour, settings.startHour, date, zone, location]);
  const sunPath = useMemo(() => mode === 'photo' ? Array.from({ length: 49 }, (_, index) => {
    const time = DateTime.fromISO(date, { zone }).startOf('day').plus({ minutes: index * 30 });
    return { time, ...getSolarVector(time, location.lat, location.lon) };
  }) : [], [mode, date, zone, location]);
  const invalidDuration = travel.durationMinutes !== '' && (!Number.isFinite(Number(travel.durationMinutes)) || Number(travel.durationMinutes) < 1 || Number(travel.durationMinutes) > 1440);
  const result = useMemo(() => {
    if (!rawRoute || rawRoute.key !== key || invalidDuration || !departing.isValid) return null;
    const duration = travel.durationMinutes === '' ? rawRoute.duration * (travel.profile === 'bus' ? 1.28 : 1) : Number(travel.durationMinutes) * 60;
    const timeline = processTravelRoute(rawRoute.coordinates, departing.toISO(), duration, travel.backward ? 'BACKWARD' : 'FORWARD', rawRoute.segmentDurations);
    return { ...summarizeRoute(timeline), timeline, coordinates: rawRoute.coordinates, duration, distance: rawRoute.distance,
      arrival: departing.plus({ seconds: duration }) };
  }, [rawRoute, key, invalidDuration, departing, travel.durationMinutes, travel.profile, travel.backward]);
  const comparisons = useMemo(() => result ? [-60, -30, 0, 30, 60].map((offset) => {
    const departure = departing.plus({ minutes: offset });
    const timeline = offset === 0 ? result.timeline : processTravelRoute(result.coordinates, departure.toISO(), result.duration,
      travel.backward ? 'BACKWARD' : 'FORWARD', rawRoute.segmentDurations);
    return { offset, departure, ...summarizeRoute(timeline) };
  }) : [], [result, departing, travel.backward, rawRoute]);

  useEffect(() => { if (validSettings(settings) && !writeStorage('helio_workspace_v2', settings)) setStorageWarning(true); }, [settings]);
  useEffect(() => { setZoneDraft(zone); setZoneError(''); }, [zone]);
  useEffect(() => {
    setRouteError(''); setLoading(false);
    return () => { requestRef.current?.abort(); };
  }, [key]);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth.getSession().then(({ data, error }) => { if (alive) { if (error) setNotice('Cloud session unavailable. Local planning still works.'); else setUser(data.session?.user || null); } })
      .catch(() => { if (alive) setNotice('Cloud session unavailable. Local planning still works.'); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (alive) setUser(session?.user || null); });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  const calculate = async () => {
    setRouteError('');
    if (!travel.origin || !travel.destination) { setRouteError('Choose origin and destination from suggestions or enter coordinates.'); return; }
    if (haversineMeters(travel.origin, travel.destination) < 10) { setRouteError('Choose two locations at least 10 meters apart.'); return; }
    if (invalidDuration) { setRouteError('Journey duration must be 1 to 1440 minutes.'); return; }
    if (!departing.isValid) { setRouteError('Select a valid departure time and timezone.'); return; }
    // Reject nonexistent local times during a DST spring-forward transition.
    if (departing.toFormat("yyyy-MM-dd'T'HH:mm") !== travel.departure) { setRouteError('This local time does not exist because the clocks change. Choose another time.'); return; }
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${travel.origin.lon},${travel.origin.lat};${travel.destination.lon},${travel.destination.lat}?overview=full&geometries=geojson&steps=false&annotations=duration`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Road routing is unavailable. Try again shortly.');
      const payload = await response.json(); const route = payload.routes?.[0];
      if (payload.code !== 'Ok' || !route?.geometry?.coordinates || !Number.isFinite(route.duration) || route.duration <= 0
        || !Number.isFinite(route.distance)) throw new Error('No road route found between these locations. Try nearby places.');
      const candidate = { key, coordinates: route.geometry.coordinates, duration: route.duration, distance: route.distance,
        segmentDurations: route.legs?.flatMap((leg) => leg.annotation?.duration || []) };
      // Validate the entire provider geometry before accepting it into the workspace.
      processTravelRoute(candidate.coordinates, departing.toISO(), candidate.duration, 'FORWARD', candidate.segmentDurations);
      if (controller.signal.aborted) return;
      setRawRoute(candidate); setNotice('Road route ready. Time and seat changes recalculate locally.');
      if (user) cacheCalculation(user.id, 'travel', { ...travel, zone }, { distance: route.distance, duration: route.duration })
        .catch(() => setNotice('Route computed. Cloud copy failed; your local plan is available.'));
    } catch (error) {
      if (!controller.signal.aborted || timedOut) setRouteError(timedOut ? 'Road routing timed out. Check your connection and retry.' : error.message);
    } finally { window.clearTimeout(timeout); if (requestRef.current === controller) setLoading(false); }
  };

  const commitZone = () => {
    const candidate = zoneDraft.trim();
    if (!candidate || !DateTime.now().setZone(candidate).isValid) { setZoneError('Use an IANA timezone, e.g. Asia/Kolkata.'); return; }
    update({ zone: candidate }); setZoneError('');
  };
  const exportCSV = () => {
    if (mode === 'travel' && !result) { setNotice('Compute a road route before exporting its report.'); return; }
    const rows = [['Sun Aleka', active.title], ['Timezone', zone], ['Date', mapDate], ['Location', mapLocation.label], ['Latitude', mapLocation.lat], ['Longitude', mapLocation.lon], []];
    if (mode === 'travel') {
      rows.push(['Origin', travel.origin.label], ['Destination', travel.destination.label], ['Recommended side', result.recommendation],
        ['Distance (km)', result.distance / 1000], ['Journey duration (minutes)', result.duration / 60], ['Arrival', result.arrival.toISO()],
        ['Seat faces backward', travel.backward], [], ['Timestamp', 'Duration seconds', 'Latitude', 'Longitude', 'Sun azimuth degrees', 'Sun altitude degrees', 'Exposure side', 'Low-sun category']);
      result.timeline.forEach((p) => rows.push([p.timestamp, p.durationSeconds, p.latitude, p.longitude, p.sunAzimuth, p.sunAltitude, p.side, p.glareLevel]));
    } else if (mode === 'property') {
      rows.push(['Model', 'Relative direct incidence on vertical walls. Not thermal load.'], ['Facade', 'Bearing degrees', 'Reference day', 'AM index %', 'PM index %']);
      rooms.forEach((room) => room.totals.forEach((period) => rows.push([room.name, room.angle, period.name, period.morning, period.afternoon])));
    } else if (mode === 'photo') {
      rows.push(['Phase', 'Start', 'End', 'Bearing degrees', 'Sun altitude degrees']);
      windows.forEach((w) => rows.push([w.label, w.start?.toISO() || 'Unavailable', w.end?.toISO() || 'Unavailable', w.vector?.azimuth, w.vector?.altitude]));
    } else {
      rows.push(['Model', 'Flat-ground shadow projection; coverage not measured.'], ['Structure', 'Height meters', 'Width meters', 'Timestamp', 'Shadow length meters', 'Shadow bearing degrees']);
      settings.structures.forEach((s) => hours.forEach((h) => { const shadow = getShadowVector(h.solar.altitude, h.solar.azimuth, s.height);
        rows.push([s.label, s.height, s.footprint, h.time.toISO(), Number.isFinite(shadow.length) ? shadow.length : 'No sun', shadow.direction]); }));
    }
    downloadFile(`sun_aleka-${mode}-${mapDate}.csv`, createCSV(rows)); setNotice('Report exported.');
  };
  const savePlan = (event) => {
    event.preventDefault(); if (!planName.trim()) return;
    if (invalidDuration) { setNotice('Fix the journey duration before saving.'); return; }
    const next = [{ id: crypto.randomUUID(), name: planName.trim().slice(0, 100), createdAt: new Date().toISOString(), settings }, ...plans].slice(0, 30);
    if (!writeStorage('helio_plans_v2', next)) { setNotice('Device storage is unavailable or full. Export a report or copy a plan link.'); return; }
    setPlans(next); setSaveOpen(false); setNotice('Plan saved on this device.');
  };
  const copyPlan = async () => {
    if (invalidDuration) { setNotice('Fix the journey duration before sharing.'); return; }
    const url = new URL(window.location.href); url.hash = `plan=${encodeURIComponent(JSON.stringify(settings))}`;
    try { await navigator.clipboard.writeText(url.toString()); setNotice('Plan link copied. It contains your locations and settings.'); }
    catch { setNotice('Clipboard unavailable. Use the plan link below.'); setShareURL(url.toString()); }
  };
  const [shareURL, setShareURL] = useState('');
  const calendar = () => { downloadFile(`sun_aleka-shoot-${date}.ics`, createCalendar(windows, location), 'text/calendar;charset=utf-8'); setNotice('Shoot calendar exported.'); };
  const authenticate = async (event) => {
    event.preventDefault(); setAuthBusy(true); setAuthMessage('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
      if (error) throw error; setAuthMessage('Check your inbox for a sign-in link. Local planning remains available.');
    } catch (error) { setAuthMessage(error.message); }
    finally { setAuthBusy(false); }
  };

  return <main className="console-shell">
    <a className="skip-link" href="#planner-panel">Skip to planner</a>
    <header className="console-header"><div className="brand"><div className="sun-mark"><span /></div><div><h1>Sun Aleka</h1><p>Make the most of the sun</p></div></div>
      <details className="time-settings"><summary>Time settings</summary><div className="timezone-field"><label htmlFor="timezone">Planning timezone</label><input id="timezone" className="inset-input" value={zoneDraft} list="timezones" aria-invalid={Boolean(zoneError)}
        onChange={(event) => setZoneDraft(event.target.value)} onBlur={commitZone} onKeyDown={(event) => { if (event.key === 'Enter') commitZone(); }} />
        <datalist id="timezones">{['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Tokyo', 'Australia/Sydney'].map((z) => <option value={z} key={z} />)}</datalist>
        {zoneError && <small className="field-error" role="alert">{zoneError}</small>}
        <button className="device-zone" type="button" onClick={useDeviceZone}>Use device timezone</button></div></details>
      <button type="button" className="sync-button" onClick={() => setLibraryOpen(true)}>Saved plans <b>{plans.length}</b></button>
      {isSupabaseConfigured ? <button type="button" className="sync-button" onClick={async () => {
        if (!user) { setAuthOpen(true); return; }
        const { error } = await supabase.auth.signOut(); setNotice(error ? error.message : 'Signed out. Local plans remain on this device.');
      }}>{user ? 'Sign out' : 'Cloud sign in'}</button> : <span className="local-status"><i /> Local workspace</span>}
    </header>
    <div className="setup-strip"><div><strong>What are you planning?</strong><p>Choose a tool. Add a place. Get your answer.</p></div>
      <button className="mechanical-button locate-main" type="button" disabled={locating} onClick={locate}>{locating ? 'Locating…' : 'Use my location'}</button>
      <span>Times shown in {DateTime.now().setZone(zone).toFormat('ZZZZ')}.</span></div>
    {locationError && <section className="global-location-help" aria-label="Location help"><p role="status">{locationError}</p><div className="location-help-grid"><div><button className="secondary-button" type="button" disabled={locating} onClick={findCity}>{locating ? 'Finding your city…' : 'Find my city instead'}</button><small>Uses ipapi.co and your public IP address. Approximate city only.</small></div><LocationSearch label="Choose your city" value={null} onSelect={(place) => { setSettings((old) => ({ ...old, location: place, travel: { ...old.travel, origin: place } })); setLocationError(''); }} /></div></section>}
    <nav className="mode-switcher" aria-label="Solar planners" role="tablist">{MODES.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }}
      type="button" role="tab" className={mode === item.id ? 'active' : ''} id={`${item.id}-tab`} aria-selected={mode === item.id} aria-controls="planner-panel"
      tabIndex={mode === item.id ? 0 : -1} onClick={() => update({ mode: item.id })} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 4) % 4;
        update({ mode: MODES[next].id }); tabRefs.current[next]?.focus();
      }}>{item.title}</button>)}</nav>
    <div className="planner-heading"><div><h2>{active.description}</h2></div><details className="plan-actions" onClick={(event) => { if (event.target.closest('button')) event.currentTarget.open = false; }}><summary>Save or share</summary><div className="button-row">
      <button className="secondary-button" type="button" onClick={() => { setPlanName(`${active.title} · ${mapDate}`); setSaveOpen(true); }}>Save plan</button>
      <button className="secondary-button" type="button" onClick={copyPlan}>Copy plan link</button>
      <button className="secondary-button" type="button" onClick={exportCSV} disabled={mode === 'travel' && !result}>Export CSV</button>
    </div></details></div>
    {storageWarning && <p className="warning-banner" role="status">Device storage is unavailable. Export reports or copy a plan link to keep your work.</p>}
    {notice && <div className="notice-banner" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    <section id="planner-panel" role="tabpanel" aria-labelledby={`${mode}-tab`} tabIndex={0} className="panel-stage">
      {mode === 'travel' && <TravelPanel settings={settings} updateTravel={updateTravel} result={result} loading={loading} routeError={invalidDuration ? 'Journey duration must be 1 to 1440 minutes.' : routeError}
        calculate={calculate} comparisons={comparisons} applyDeparture={(departure) => updateTravel({ departure: departure.toFormat("yyyy-MM-dd'T'HH:mm") })} />}
      {mode === 'property' && <PropertyPanel settings={settings} update={update} rooms={rooms} />}
      {mode === 'photo' && <PhotographyPanel settings={settings} update={update} windows={windows} daylight={daylight} sunPath={sunPath} calendar={calendar} />}
      {mode === 'event' && <EventPanel settings={settings} update={update} hours={hours} />}
    </section>
    <details className="map-disclosure" onToggle={(event) => setMapOpen(event.currentTarget.open)}><summary>View map, sunrise and sunset</summary>{mapOpen && <>    <div className="map-dashboard"><SkeuomorphicCard title="Map" className="map-card" action={<span className="map-mode-label">{mode === 'travel' ? 'Road route' : mode === 'event' ? `${settings.selectedHour}:00 shadows` : 'Sun bearings'}</span>}>
      <SolarMap settings={settings} routeResult={result} windows={windows} hours={hours} onPickLocation={(picked) => update({ location: picked })} />
    </SkeuomorphicCard><SkeuomorphicCard title="Sunrise & sunset" tone="graphite" className="daylight-card">
      <p className="site-name">{mapLocation.label}</p><p className="coordinate-caption">{mapLocation.lat.toFixed(4)}°, {mapLocation.lon.toFixed(4)}°</p>
      <div className="daylight-duration"><span>{daylight.polar || 'DAYLIGHT'}</span><strong>{daylight.daylightHours === null ? '—' : `${Math.floor(Math.round(daylight.daylightHours * 60) / 60)}h ${Math.round(daylight.daylightHours * 60) % 60}m`}</strong></div>
      <div className="daylight-times"><div><span>Sunrise</span><strong>{clock(daylight.sunrise)}</strong></div><div><span>Sunset</span><strong>{clock(daylight.sunset)}</strong></div></div>
      <div className="context-strip"><span>{mapDate}</span><span>{zone}</span><span>UTC{DateTime.fromISO(mapDate, { zone }).toFormat('ZZ')}</span></div>
      <p className="microcopy">{mode === 'travel' ? 'Sunrise and sunset at the origin.' : 'For the selected site and date.'} Solar calculations run locally. Place search, road routes and map tiles use online services.</p>
    </SkeuomorphicCard></div>
</>}</details>
    <details className="daily-disclosure"><summary>Plan a walk, picnic or other outdoor activity</summary><ActivityPlanner daylight={daylight} location={mapLocation} /></details>
    <footer className="console-footer"><span>Sun Aleka</span><span>Sun estimates · Allow for clouds and nearby buildings</span></footer>
    <Dialog open={saveOpen} title="Save this plan" onClose={() => setSaveOpen(false)}><form className="control-stack" onSubmit={savePlan}>
      <label className="field"><span>Plan name</span><input className="inset-input" value={planName} maxLength={100} required autoFocus onChange={(event) => setPlanName(event.target.value)} /></label>
      <p className="microcopy">Stores your settings on this device. Road routes are fetched again when you reopen a travel plan.</p>
      <button type="submit" className="mechanical-button">Save plan</button></form></Dialog>
    <Dialog open={libraryOpen} title="Saved plans" onClose={() => setLibraryOpen(false)}>
      <p className="microcopy">Up to 30 plans on this browser. Export reports before clearing browser data.</p>
      {plans.length === 0 ? <p className="library-empty">No saved plans yet. Use “Save plan” in any planner.</p> : <div className="plan-list">{plans.map((plan) => <article key={plan.id}>
        <div><h3>{plan.name}</h3><p>{MODES.find((m) => m.id === plan.settings.mode).title} · {plan.settings.date} · {plan.settings.zone}</p></div><div className="button-row">
          <button className="secondary-button" type="button" aria-label={`Open ${plan.name}`} onClick={() => { requestRef.current?.abort(); setRawRoute(null); setSettings(plan.settings); setLibraryOpen(false); setNotice('Plan restored. Travel plans need a fresh road route.'); }}>Open</button>
          <button className="secondary-button danger-button" type="button" aria-label={`Delete ${plan.name}`} onClick={() => {
            const next = plans.filter((p) => p.id !== plan.id);
            if (writeStorage('helio_plans_v2', next)) { setPlans(next); setNotice('Saved plan deleted.'); } else setNotice('Could not update device storage.');
          }}>Delete</button></div></article>)}</div>}
    </Dialog>
    <Dialog open={Boolean(shareURL)} title="Copy plan link" onClose={() => setShareURL('')}><label className="field"><span>Plan URL</span><textarea className="inset-input share-url" readOnly value={shareURL} onFocus={(event) => event.target.select()} /></label></Dialog>
    {isSupabaseConfigured && <Dialog open={authOpen} title="Cloud sign in" onClose={() => setAuthOpen(false)}><form className="control-stack" onSubmit={authenticate}>
      <label className="field"><span>Email</span><input className="inset-input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <p className="microcopy">Sign in to store a cloud copy of future route calculations. Saved plans stay on this browser.</p>
      <button className="mechanical-button" type="submit" disabled={authBusy}>{authBusy ? 'Sending…' : 'Send sign-in link'}</button>
      {authMessage && <p role="status" className="field-hint">{authMessage}</p>}</form></Dialog>}
  </main>;
}
