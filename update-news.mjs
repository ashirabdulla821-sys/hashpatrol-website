// Collects car headlines from public RSS feeds and saves them to data/news.json.
// Runs every day from GitHub Actions. Needs Node 18 or newer, and no extra packages.
// Only the headline, link, source and date are saved. Readers click through to the publisher.
import { writeFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';

// Add or remove feeds here. Each one needs a name and the feed address.
// The name must end with " · Region" (USA, India, UK, Australia or Canada) so the site can filter by region.
// IMPORTANT: check each publisher's terms before using its feed on a site that shows ads.
// This script saves only the headline, link, source and date, and every card links to the publisher.
const FEEDS = [
  // USA
  { name: 'Motor1 · USA', url: 'https://www.motor1.com/rss/articles/all/' },
  { name: 'Car and Driver · USA', url: 'https://www.caranddriver.com/rss/all.xml/' },
  { name: 'Autoblog · USA', url: 'https://www.autoblog.com/rss.xml' },
  { name: 'Electrek · USA', url: 'https://electrek.co/feed/' },
  // India
  { name: 'Rushlane · India', url: 'https://www.rushlane.com/feed' },
  { name: 'India Car News · India', url: 'https://indiacarnews.com/feed' },
  { name: 'evo India · India', url: 'https://www.evoindia.com/feed' },
  // UK
  { name: 'Autocar · UK', url: 'https://www.autocar.co.uk/rss' },
  { name: 'The Drive UK · UK', url: 'https://www.thedrive.co.uk/feed' },
  { name: 'Motor Verso · UK', url: 'https://www.motorverso.com/feed' },
  // Australia
  { name: 'Drive · Australia', url: 'https://www.drive.com.au/feed' },
  { name: 'CarExpert · Australia', url: 'https://www.carexpert.com.au/feed' },
  { name: 'GoAuto · Australia', url: 'https://www.goauto.com.au/rss/news/35.xml' },
  // Canada
  { name: "Le Guide de l'auto · Canada", url: 'https://www.guideautoweb.com/en/rss.xml' },
];

const PER_FEED = 6;     // newest items kept from each feed, so every region appears
const MAX_ITEMS = 90;

const decode = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, '')
    .trim();

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decode(m[1]) : '';
};

function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = pick(b, 'title');
    let link = pick(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); // Atom feeds
      link = m ? m[1] : '';
    }
    const date = pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated');
    const time = Date.parse(date);
    if (title && /^https?:\/\//.test(link) && !Number.isNaN(time)) {
      items.push({ title, link, source, date: new Date(time).toISOString() });
    }
  }
  return items;
}

async function load(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'HashPatrolBot/1.0 (+https://hashpatrol.com)' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = parseFeed(await res.text(), feed.name)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, PER_FEED);
    console.log(`${feed.name}: ${items.length} items`);
    return items;
  } catch (e) {
    console.warn(`${feed.name}: skipped (${e.message})`);
    return [];
  }
}

const all = (await Promise.all(FEEDS.map(load))).flat();
const seen = new Set();
const items = all
  .sort((a, b) => b.date.localeCompare(a.date))
  .filter((i) => !seen.has(i.link) && seen.add(i.link))
  .slice(0, MAX_ITEMS);

if (items.length === 0) {
  console.error('No items found, so the old data file is kept.');
  process.exit(0);
}

await mkdir('data', { recursive: true });
await writeFile('data/news.json', JSON.stringify({ updated: new Date().toISOString(), items }, null, 2));
console.log(`Saved ${items.length} headlines.`);

// Day-by-day archive: one file per day, kept for the last 90 days.
const KEEP_DAYS = 90;
const today = new Date().toISOString().slice(0, 10);
await mkdir('data/archive', { recursive: true });
await writeFile(`data/archive/news-${today}.json`, JSON.stringify({ updated: new Date().toISOString(), items }, null, 2));

let days = [];
try {
  days = JSON.parse(await readFile('data/archive/index.json', 'utf8')).days || [];
} catch (e) {
  /* first run: no index yet */
}
days = [...new Set([today, ...days])].sort().reverse().slice(0, KEEP_DAYS);
await writeFile('data/archive/index.json', JSON.stringify({ days }, null, 2));

for (const f of await readdir('data/archive')) {
  const m = f.match(/^news-(\d{4}-\d{2}-\d{2})\.json$/);
  if (m && !days.includes(m[1])) await unlink(`data/archive/${f}`);
}
console.log(`Archive now holds ${days.length} days.`);
