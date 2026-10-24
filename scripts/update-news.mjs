// Collects car headlines from public RSS feeds and saves them to data/news.json.
// Runs every day from GitHub Actions. Needs Node 18 or newer, and no extra packages.
// Only the headline, link, source and date are saved. Readers click through to the publisher.
import { writeFile, mkdir } from 'node:fs/promises';

// Add or remove feeds here. Each one needs a name and the feed address.
const FEEDS = [
  { name: 'Motor1', url: 'https://www.motor1.com/rss/articles/all/' },
  { name: 'Car and Driver', url: 'https://www.caranddriver.com/rss/all.xml/' },
  { name: 'Autoblog', url: 'https://www.autoblog.com/rss.xml' },
  { name: 'Electrek', url: 'https://electrek.co/feed/' },
];

const MAX_ITEMS = 40;

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
    const items = parseFeed(await res.text(), feed.name);
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
