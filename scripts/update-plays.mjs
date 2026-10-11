// Refreshes the play counts in index.html from the Roblox API.
// Run with: node scripts/update-plays.mjs
// Each game entry's plays:"…" is updated using the place ID from its Roblox url.
// Games marked private:true, or that Roblox returns nothing for, keep their existing number.
import { readFile, writeFile } from "node:fs/promises";

const FILE = new URL("../index.html", import.meta.url);

// Matches one game entry: its name, current plays text, the fields in between, and Roblox place ID.
const ENTRY = /\{n:"([^"]*)", plays:"([^"]*)"([^{]*?)url:"https:\/\/www\.roblox\.com\/games\/(\d+)/g;

// Same style as the site: 17.72M, 278.4K, 850
const formatPlays = n => {
  if (n >= 999_950) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
};

// Same style as the site's banner stat: 77.9M+, 45.4K+, 850+
const formatTotal = n => {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M+";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K+";
  return Math.round(n) + "+";
};

const playsToNumber = str => {
  const m = String(str).match(/([\d.]+)\s*([MmKk]?)/);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  return suffix === "M" ? num * 1e6 : suffix === "K" ? num * 1e3 : num;
};

const getJson = async url => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} from ${url}`);
    await new Promise(r => setTimeout(r, 2000 * attempt));
  }
};

const html = await readFile(FILE, "utf8");
const entries = [...html.matchAll(ENTRY)].map(m => ({ name: m[1], plays: m[2], placeId: m[4], private: /private:\s*true/.test(m[3]) }));
if (!entries.length) throw new Error("No game entries found in index.html");

// Place ID -> universe ID (the games API is keyed by universe).
for (const e of entries) {
  if (e.private) continue;
  try {
    e.universeId = (await getJson(`https://apis.roblox.com/universes/v1/places/${e.placeId}/universe`)).universeId;
  } catch (err) {
    console.warn(`Could not resolve universe for ${e.name}: ${err.message}`);
  }
}

// Fetch visits in batches of 50 (the API's limit).
const visits = new Map();
const universeIds = entries.map(e => e.universeId).filter(Boolean);
for (let i = 0; i < universeIds.length; i += 50) {
  const { data } = await getJson(`https://games.roblox.com/v1/games?universeIds=${universeIds.slice(i, i + 50).join(",")}`);
  for (const g of data) visits.set(g.id, g.visits);
}

let out = html;
let changed = 0;
for (const e of entries) {
  if (e.private) {
    console.log(`Keeping ${e.name} at ${e.plays} (private)`);
    continue;
  }
  const v = visits.get(e.universeId);
  if (!v) {
    console.warn(`Skipping ${e.name}: no visit count returned`);
    continue;
  }
  const next = `${formatPlays(v)} Plays`;
  if (next !== e.plays) {
    out = out.replace(`{n:"${e.name}", plays:"${e.plays}"`, `{n:"${e.name}", plays:"${next}"`);
    console.log(`${e.name}: ${e.plays} -> ${next}`);
    changed++;
  }
  e.plays = next;
}

// Keep the no-JavaScript fallback values in the stats banner in sync.
const total = entries.reduce((sum, e) => sum + playsToNumber(e.plays), 0);
out = out
  .replace(/(id="totalPlays">)[^<]*/, `$1${formatTotal(total)}`)
  .replace(/(id="totalGames">)[^<]*/, `$1${entries.length}`);

if (out !== html) await writeFile(FILE, out);
console.log(`${changed} game(s) updated. Total: ${formatTotal(total)} across ${entries.length} games.`);
