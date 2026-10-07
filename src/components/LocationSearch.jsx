import { useEffect, useId, useState } from 'react';
import { isValidLocation, parseCoordinates } from '../utils/solarEngine.js';
import { PLACES, readStorage, writeStorage } from '../utils/plans.js';
import { getDeviceLocation, getNetworkLocation, locationMessage } from '../utils/location.js';

export default function LocationSearch({ label, value, onSelect, allowClear = false }) {
  const id = useId(); const listId = `${id}-options`;
  const [query, setQuery] = useState(value?.label || '');
  const [open, setOpen] = useState(false); const [remote, setRemote] = useState([]);
  const [status, setStatus] = useState(''); const [highlight, setHighlight] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [history, setHistory] = useState(() => {
    const saved = readStorage('helio_location_history', []);
    return Array.isArray(saved) ? saved.filter((p) => isValidLocation(p) && typeof p.label === 'string').slice(0, 5) : [];
  });

  useEffect(() => { if (value) setQuery(value.label); }, [value]);
  const coordinates = parseCoordinates(query);
  const candidates = coordinates ? [coordinates] : [...history, ...PLACES, ...remote]
    .filter((p) => !query.trim() || p.label.toLowerCase().includes(query.trim().toLowerCase()) || remote.includes(p));
  const seen = new Set();
  const results = candidates.filter((p) => { const key = `${p.lat},${p.lon}`;
    if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 7);

  useEffect(() => {
    setRemote([]); setHighlight(0); setStatus('');
    if (!open || query.trim().length < 3 || parseCoordinates(query) || query === value?.label) return;
    const controller = new AbortController(); let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const timer = window.setTimeout(async () => {
      setStatus('Searching places…');
      try {
        const url = new URL('https://photon.komoot.io/api/'); url.searchParams.set('q', query.trim()); url.searchParams.set('limit', '5');
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Search unavailable');
        const payload = await response.json();
        const places = (payload.features || []).map((feature) => {
          const p = feature.properties;
          return { label: [...new Set([p.name, p.city, p.state, p.country].filter(Boolean))].join(', '),
            lon: feature.geometry?.coordinates?.[0], lat: feature.geometry?.coordinates?.[1] };
        }).filter(isValidLocation);
        setRemote(places); setStatus(places.length ? '' : 'No places found. Enter latitude, longitude instead.');
      } catch (error) {
        if (error.name !== 'AbortError' || timedOut) setStatus('Online search unavailable. Use a city below or enter latitude, longitude.');
      } finally { window.clearTimeout(deadline); }
    }, 350);
    return () => { window.clearTimeout(timer); window.clearTimeout(deadline); controller.abort(); };
  }, [open, query, value?.label]);

  const choose = (place) => {
    onSelect(place); setQuery(place.label); setOpen(false); setStatus('');
    const next = [place, ...history.filter((p) => p.lat !== place.lat || p.lon !== place.lon)].slice(0, 5);
    setHistory(next); writeStorage('helio_location_history', next);
  };
  const geolocate = async () => {
    setLocating(true); setLocationError('');
    try { const { place } = await getDeviceLocation(); choose(place); }
    catch (error) { setLocationError(locationMessage(error)); }
    finally { setLocating(false); }
  };
  const findCity = async () => {
    setLocating(true);
    try { const { place } = await getNetworkLocation(); choose(place); setLocationError(''); setStatus('Approximate city from your internet connection. Check it before planning.'); }
    catch (error) { setLocationError(error.message); }
    finally { setLocating(false); }
  };

  return <div className="field location-search">
    <label htmlFor={id}>{label}</label>
    <div className="location-input-row">
      <input id={id} className="inset-input" value={query} placeholder="City or latitude, longitude" autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={open && results.length > 0} aria-controls={listId}
        aria-activedescendant={open && results[highlight] ? `${listId}-${highlight}` : undefined}
        onFocus={() => setOpen(true)} onBlur={(event) => { if (!event.currentTarget.parentElement.parentElement.contains(event.relatedTarget)) setOpen(false); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); if (allowClear && value) onSelect(null); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true); setHighlight((old) => Math.max(0, Math.min(results.length - 1, old + (event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter' && open && results[highlight]) { event.preventDefault(); choose(results[highlight]); }
        }} />
      <button type="button" className="icon-button" aria-label={`Use my location for ${label.toLowerCase()}`} disabled={locating} onClick={geolocate}>
        {locating ? '…' : 'Locate'}
      </button>
    </div>
    {open && results.length > 0 && <ul className="autocomplete" id={listId} role="listbox" aria-label={`${label} suggestions`}>
      {results.map((place, index) => <li role="option" aria-selected={index === highlight} id={`${listId}-${index}`} key={`${place.lat},${place.lon}`}>
        <button type="button" tabIndex={-1} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setHighlight(index)} onClick={() => choose(place)}>
          <span>{place.label}</span>
        </button>
      </li>)}
    </ul>}
    {status && <p className="field-hint" role="status">{status}</p>}
    {locationError && <div className="location-recovery" role="status"><p>{locationError}</p><button type="button" className="secondary-button" disabled={locating} onClick={findCity}>Find my city instead</button><small>Uses ipapi.co and your public IP address. City estimate only.</small></div>}
    {value && query !== value.label && <p className="field-hint">Current selection: {value.label}. Choose a suggestion to update.</p>}
  </div>;
}
