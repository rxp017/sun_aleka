import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendar, createCSV, defaultSettings, validSettings } from '../src/utils/plans.js';
import { getPhotographyWindows } from '../src/utils/solarEngine.js';

test('only complete bounded plan settings are accepted', () => {
  const settings = defaultSettings(); assert.equal(validSettings(settings), true);
  for (const invalid of [{ ...settings, zone: 'Fake/Timezone' }, { ...settings, location: { label: 'Bad', lat: 91, lon: 0 } },
    { ...settings, selectedHour: 99 }, { ...settings, structures: [] }, { ...settings, travel: { ...settings.travel, durationMinutes: -10 } },
    { ...settings, structures: [{ ...settings.structures[0], color: 'javascript:alert(1)' }] }]) assert.equal(validSettings(invalid), false);
  assert.equal(validSettings(null), false);
});
test('CSV safely escapes quotes, newlines and spreadsheet formulas', () => {
  const csv = createCSV([['=HYPERLINK("evil")', 'a,b', 'line\nbreak', -90]]);
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"')); assert.ok(csv.includes('"a,b"'));
  assert.ok(csv.includes('"line\nbreak"')); assert.ok(csv.includes('"-90"'));
});
test('calendar contains valid UTC events and folds UTF-8 safely', () => {
  const location = { lat: 17.385, lon: 78.4867, label: 'హైదరాబాద్ '.repeat(20) + ', Telangana; India' };
  const windows = getPhotographyWindows(location, '2026-10-03', 'Asia/Kolkata');
  const ics = createCalendar(windows, location);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 5);
  assert.ok(ics.includes('DTSTART:20261003T')); assert.ok(ics.replaceAll('\r\n ', '').includes('\\, Telangana\\; India'));
  assert.ok(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75));
});
test('polar calendars omit events that do not occur', () => {
  const location = { lat: 89, lon: 0, label: 'Polar site' };
  const windows = getPhotographyWindows(location, '2026-12-21', 'UTC');
  assert.equal((createCalendar(windows, location).match(/BEGIN:VEVENT/g) || []).length, 1);
});
