// Collects a worldwide list of car models from Wikidata (free, public domain data)
// and saves it to data/world.json: model, brand, country, first year, a link, and a photo file name
// from Wikimedia Commons when one exists (photo licenses vary, so the site links to each photo's credit page).
// Runs weekly from GitHub Actions. Needs Node 18 or newer and no extra packages.
import { writeFile, mkdir } from 'node:fs/promises';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const PAGE = 2000;      // models per request
const MAX_PAGES = 8;    // up to 16,000 models

const query = (offset) => `
SELECT ?model ?modelLabel ?makerLabel ?countryLabel ?start ?article ?image WHERE {
  { SELECT ?model WHERE { ?model wdt:P31 wd:Q3231690 } ORDER BY ?model LIMIT ${PAGE} OFFSET ${offset} }
  ?model wdt:P176 ?maker .
  OPTIONAL { ?maker wdt:P17 ?country }
  OPTIONAL { ?model wdt:P571 ?start }
  OPTIONAL { ?model wdt:P18 ?image }
  OPTIONAL { ?article schema:about ?model ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

async function page(offset) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query(offset))}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'HashPatrolBot/1.0 (https://hashpatrol.com; contact via site) Node.js',
    },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  return j.results.bindings;
}

const byId = new Map();
for (let p = 0; p < MAX_PAGES; p++) {
  let rows;
  try {
    rows = await page(p * PAGE);
  } catch (e) {
    console.warn(`Page ${p + 1} failed (${e.message}); stopping here.`);
    break;
  }
  console.log(`Page ${p + 1}: ${rows.length} rows`);
  if (rows.length === 0) break;
  for (const r of rows) {
    const name = r.modelLabel && r.modelLabel.value;
    const brand = r.makerLabel && r.makerLabel.value;
    if (!name || !brand || /^Q\d+$/.test(name) || /^Q\d+$/.test(brand)) continue; // no English label
    const id = r.model.value.split('/').pop();
    if (byId.has(id)) continue;
    const year = r.start ? new Date(r.start.value).getUTCFullYear() : null;
    const img = r.image && r.image.value.includes('Special:FilePath/')
      ? decodeURIComponent(r.image.value.split('Special:FilePath/')[1])
      : '';
    byId.set(id, {
      m: name,
      b: brand,
      c: (r.countryLabel && !/^Q\d+$/.test(r.countryLabel.value) && r.countryLabel.value) || '',
      y: Number.isFinite(year) ? year : null,
      u: r.article ? r.article.value : `https://www.wikidata.org/wiki/${id}`,
      w: r.article ? 1 : 0,
      i: img,
    });
  }
}

const models = [...byId.values()].sort((a, b) => a.b.localeCompare(b.b) || a.m.localeCompare(b.m));
if (models.length === 0) {
  console.error('Nothing was collected, so the old data file is kept.');
  process.exit(0);
}
await mkdir('data', { recursive: true });
await writeFile('data/world.json', JSON.stringify({ updated: new Date().toISOString(), source: 'Wikidata (CC0)', models }));
console.log(`Saved ${models.length} models.`);
