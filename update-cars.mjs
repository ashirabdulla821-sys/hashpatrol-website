// Collects official US car data and saves it to data/cars.json.
//   - Specs and fuel economy: US EPA (fueleconomy.gov)
//   - Crash-test star ratings: US NHTSA (api.nhtsa.gov)
// Runs every day from GitHub Actions. Needs Node 18 or newer and no extra packages.
// Prices are NOT included: there is no free official price source.
import { writeFile, mkdir } from 'node:fs/promises';

// Add the cars you want here. Use the names the US EPA uses (check fueleconomy.gov).
// The website matches by brand and model name, so keep them the same as in the Car guide.
const CARS = [
  // Toyota and Lexus
  ['Toyota', 'Camry'], ['Toyota', 'Corolla'], ['Toyota', 'RAV4'], ['Toyota', 'Prius'], ['Toyota', 'Tundra'],
  ['Toyota', 'Highlander'], ['Toyota', '4Runner'], ['Toyota', 'Tacoma'], ['Toyota', 'Sienna'], ['Toyota', 'Yaris'],
  ['Lexus', 'RX'], ['Lexus', 'ES'], ['Lexus', 'IS'], ['Lexus', 'NX'],
  // Honda, Nissan, Mazda, Subaru, Mitsubishi, Suzuki
  ['Honda', 'Civic'], ['Honda', 'Accord'], ['Honda', 'CR-V'], ['Honda', 'Pilot'], ['Honda', 'HR-V'], ['Honda', 'Odyssey'],
  ['Nissan', 'Leaf'], ['Nissan', 'Altima'], ['Nissan', 'Rogue'], ['Nissan', 'Sentra'], ['Nissan', 'Frontier'],
  ['Mazda', 'CX-5'], ['Mazda', 'CX-30'], ['Mazda', 'CX-50'], ['Mazda', 'Mazda3'], ['Mazda', 'MX-5 Miata'],
  ['Subaru', 'Forester'], ['Subaru', 'Outback'], ['Subaru', 'Impreza'], ['Subaru', 'Crosstrek'], ['Subaru', 'WRX'], ['Subaru', 'BRZ'],
  // Korea
  ['Hyundai', 'Tucson'], ['Hyundai', 'Sonata'], ['Hyundai', 'Kona'], ['Hyundai', 'Elantra'], ['Hyundai', 'Palisade'], ['Hyundai', 'Santa Fe'], ['Hyundai', 'Ioniq 5'],
  ['Kia', 'Sportage'], ['Kia', 'Telluride'], ['Kia', 'EV6'], ['Kia', 'Sorento'], ['Kia', 'Soul'], ['Kia', 'Forte'],
  ['Genesis', 'G70'], ['Genesis', 'GV80'],
  // USA
  ['Ford', 'Mustang'], ['Ford', 'Bronco'], ['Ford', 'Explorer'], ['Ford', 'Escape'], ['Ford', 'Maverick'], ['Ford', 'Mustang Mach-E'],
  ['Chevrolet', 'Corvette'], ['Chevrolet', 'Equinox'], ['Chevrolet', 'Malibu'], ['Chevrolet', 'Bolt EV'],
  ['Jeep', 'Wrangler'], ['Jeep', 'Grand Cherokee'], ['Jeep', 'Gladiator'],
  ['Dodge', 'Charger'], ['Dodge', 'Challenger'],
  ['Tesla', 'Model 3'], ['Tesla', 'Model Y'], ['Tesla', 'Model S'], ['Tesla', 'Model X'], ['Tesla', 'Cybertruck'],
  ['Rivian', 'R1T'], ['Lucid', 'Air'],
  // Europe
  ['Volkswagen', 'Tiguan'], ['Volkswagen', 'Golf'], ['Volkswagen', 'Jetta'], ['Volkswagen', 'Atlas'], ['Volkswagen', 'ID.4'],
  ['Volvo', 'XC90'], ['Volvo', 'XC60'], ['Volvo', 'XC40'], ['Polestar', '2'],
];

const thisYear = new Date().getFullYear();
const YEARS = [thisYear + 1, thisYear, thisYear - 1]; // newest model year first

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'HashPatrolBot/1.0 (+https://hashpatrol.com)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const q = encodeURIComponent;

async function economy(make, model, year) {
  const m = await getJson(`https://www.fueleconomy.gov/ws/rest/vehicle/menu/options?year=${year}&make=${q(make)}&model=${q(model)}`);
  const first = list(m.menuItem)[0];
  if (!first) return null;
  const v = await getJson(`https://www.fueleconomy.gov/ws/rest/vehicle/${first.value}`);
  const electric = Number(v.range) > 0;
  return {
    variant: first.text,
    engine: Number(v.displ) > 0 ? `${v.displ} L, ${v.cylinders} cylinders` : electric ? 'Electric motor' : '',
    transmission: v.trany || '',
    drive: v.drive || '',
    fuel: v.fuelType || '',
    combined: v.comb08 ? `${v.comb08} mpg combined` : '',
    cityHighway: v.city08 && v.highway08 ? `${v.city08} / ${v.highway08} mpg` : '',
    range: electric ? `${v.range} miles` : '',
  };
}

async function safety(make, model, year) {
  const l = await getJson(`https://api.nhtsa.gov/SafetyRatings/modelyear/${year}/make/${q(make)}/model/${q(model)}`);
  const first = list(l.Results)[0];
  if (!first) return null;
  const d = await getJson(`https://api.nhtsa.gov/SafetyRatings/VehicleId/${first.VehicleId}`);
  const r = list(d.Results)[0] || {};
  return {
    variant: first.VehicleDescription || '',
    overall: r.OverallRating || '',
    front: r.OverallFrontCrashRating || '',
    side: r.OverallSideCrashRating || '',
    rollover: r.RolloverRating || '',
  };
}

async function firstYear(fn, make, model) {
  for (const y of YEARS) {
    try {
      const out = await fn(make, model, y);
      if (out) return { year: y, out };
    } catch (e) {
      /* try the next year */
    }
  }
  return null;
}

const cars = [];
for (const [make, model] of CARS) {
  const fe = await firstYear(economy, make, model);
  const sf = await firstYear(safety, make, model);
  if (!fe && !sf) {
    console.warn(`${make} ${model}: nothing found`);
    continue;
  }
  cars.push({
    make,
    model,
    year: fe ? fe.year : sf.year,
    fe: fe ? fe.out : null,
    ncap: sf ? { year: sf.year, ...sf.out } : null,
  });
  console.log(`${make} ${model}: ${fe ? 'specs' : '-'} ${sf ? 'safety' : '-'}`);
}

if (cars.length === 0) {
  console.error('Nothing was collected, so the old data file is kept.');
  process.exit(0);
}
await mkdir('data', { recursive: true });
await writeFile('data/cars.json', JSON.stringify({ updated: new Date().toISOString(), cars }, null, 2));
console.log(`Saved ${cars.length} cars.`);
