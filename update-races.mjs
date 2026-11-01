// Collects the Formula 1 race schedule from the Jolpica F1 API (the open successor to Ergast)
// and saves it to data/races.json. Runs daily from GitHub Actions. Needs Node 18 or newer.
// Other series (NASCAR, IMSA, Le Mans, Baja, Dakar) have no open schedule feed, so they stay manual.
import { writeFile, mkdir } from 'node:fs/promises';

const year = new Date().getUTCFullYear();
const today = new Date().toISOString().slice(0, 10);

async function season(y) {
  const res = await fetch(`https://api.jolpi.ca/ergast/f1/${y}.json`, {
    headers: { Accept: 'application/json', 'User-Agent': 'HashPatrolBot/1.0 (+https://hashpatrol.com)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return (j.MRData && j.MRData.RaceTable && j.MRData.RaceTable.Races) || [];
}

const rows = [];
for (const y of [year, year + 1]) {
  try {
    const races = await season(y);
    console.log(`${y}: ${races.length} races`);
    rows.push(...races);
  } catch (e) {
    console.warn(`${y}: skipped (${e.message})`);
  }
}

const SESSIONS = [
  ['FirstPractice', 'Practice 1'],
  ['SecondPractice', 'Practice 2'],
  ['ThirdPractice', 'Practice 3'],
  ['SprintQualifying', 'Sprint qualifying'],
  ['SprintShootout', 'Sprint qualifying'],
  ['Sprint', 'Sprint'],
  ['Qualifying', 'Qualifying'],
];

const stamp = (x) => `${x.date}T${x.time || '12:00:00Z'}`;

const races = rows
  .filter((r) => r.date >= today)
  .map((r) => {
    const sessions = SESSIONS.filter(([k]) => r[k] && r[k].date).map(([k, name]) => ({
      name,
      date: r[k].date,
      time: r[k].time || '',
    }));
    sessions.push({ name: 'Race', date: r.date, time: r.time || '' });
    sessions.sort((a, b) => stamp(a).localeCompare(stamp(b)));
    return {
      season: r.season,
      round: Number(r.round),
      name: r.raceName,
      circuit: r.Circuit && r.Circuit.circuitName,
      place: r.Circuit && r.Circuit.Location ? `${r.Circuit.Location.locality}, ${r.Circuit.Location.country}` : '',
      date: r.date,
      time: r.time || '',
      sessions, // every session with its date and UTC time; the site shows them in the visitor's local time
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

if (races.length === 0) {
  console.error('No upcoming races found, so the old data file is kept.');
  process.exit(0);
}
await mkdir('data', { recursive: true });
await writeFile(
  'data/races.json',
  JSON.stringify({ updated: new Date().toISOString(), series: 'Formula 1', source: 'Jolpica F1 API', races }, null, 2)
);
console.log(`Saved ${races.length} upcoming races.`);
