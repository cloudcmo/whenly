#!/usr/bin/env node
// scripts/add-images.js  (Whenly)
//
// Fills the Whenly sheet's image column (D) with a free-to-use Pexels photo,
// searched on the QUESTION TEXT ONLY so the picture can never reveal the year.
//
// Sheet columns:  A date | B category | C question | D image | E answer |
//                 F min  | G max      | H explainer
//
//   node scripts/add-images.js                only future rows missing an image
//   node scripts/add-images.js --all          also fill past rows missing an image
//   node scripts/add-images.js --all --overwrite
//                                             REPLACE every image (the one-off
//                                             clean-up: swaps all historical
//                                             images for licence-safe Pexels ones)
//   node scripts/add-images.js --dry-run      show matches, write nothing
//   node scripts/add-images.js --all --overwrite --limit=180
//                                             stop after 180 Pexels lookups
//                                             (free tier ~200/hour). Re-run the
//                                             same command later to continue.
//
// Reuses image-search.config.json (sheetId + pexelsApiKey + googleServiceAccount).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'image-search.config.json');
const RESULTS_PATH = path.join(__dirname, '..', 'image-search-results.json');
const IMAGE_COL = 'D';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const INCLUDE_PAST = args.includes('--all');
const OVERWRITE = args.includes('--overwrite');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

async function main() {
  const config = loadConfig(['sheetId', 'pexelsApiKey', 'googleServiceAccount']);
  const token = await getAccessToken(config.googleServiceAccount);
  const tab = await getFirstTabTitle(config.sheetId, token);
  const rows = await fetchRows(config.sheetId, token, tab); // A2:H
  const todayISO = new Date().toISOString().slice(0, 10);

  const updates = [], skipped = [], results = [];
  let lookups = 0, stoppedAtLimit = false;

  for (let i = 0; i < rows.length; i++) {
    const [date, , question, image] = rows[i];
    const sheetRow = i + 2;
    if (!question || !question.trim()) continue;
    if (!OVERWRITE && image && image.trim()) { skipped.push(`row ${sheetRow}: already has an image`); continue; }
    if (!INCLUDE_PAST && date && date.trim() < todayISO) { skipped.push(`row ${sheetRow}: past date`); continue; }
    if (lookups >= LIMIT) { stoppedAtLimit = true; break; }

    const query = buildSearchQuery(question);
    if (!query) { skipped.push(`row ${sheetRow}: could not build a query`); continue; }

    lookups++;
    let photo;
    try { photo = await searchPexels(query, config.pexelsApiKey); }
    catch (err) { skipped.push(`row ${sheetRow}: Pexels error: ${err.message}`); continue; }
    if (!photo) { skipped.push(`row ${sheetRow}: no Pexels match for "${query}"`); continue; }

    updates.push({ range: `${tab}!${IMAGE_COL}${sheetRow}`, values: [[photo.imageUrl]] });
    results.push({ sheetRow, date: (date || '').trim(), question: question.trim(), searchQuery: query, imageUrl: photo.imageUrl, pexelsPageUrl: photo.pageUrl, photographer: photo.photographer });
    await sleep(250);
  }

  if (updates.length && !DRY_RUN) await batchWrite(config.sheetId, token, updates);

  console.log('');
  console.log(`${DRY_RUN ? '[DRY RUN] Would update' : 'Updated'} ${updates.length} image(s)${OVERWRITE ? ' (overwrite mode)' : ''}.`);
  if (skipped.length) { console.log(`Skipped ${skipped.length}:`); skipped.slice(0, 40).forEach(s => console.log(`  ${s}`)); if (skipped.length > 40) console.log(`  …and ${skipped.length - 40} more`); }
  if (stoppedAtLimit) { console.log(`\nStopped after ${lookups} lookups (--limit=${LIMIT}). Re-run the same command later to continue.`); }

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`\nWrote details of ${results.length} chosen image(s) to ${path.basename(RESULTS_PATH)}`);
}

function loadConfig(required) {
  if (!fs.existsSync(CONFIG_PATH)) { console.error(`Missing ${CONFIG_PATH} — copy image-search.config.example.json and fill it in.`); process.exit(1); }
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of required) if (!c[k]) { console.error(`config is missing "${k}"`); process.exit(1); }
  return c;
}
function base64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  const unsigned = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(claim)))}`;
  const signer = crypto.createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const jwt = `${unsigned}.${base64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  if (!res.ok) throw new Error(`Google auth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}
async function getFirstTabTitle(sheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to read metadata: ${await res.text()}`);
  const sheets = (await res.json()).sheets || [];
  const first = sheets.find(s => s.properties && s.properties.sheetId === 0) || sheets[0];
  if (!first) throw new Error('No tabs found');
  return first.properties.title;
}
async function fetchRows(sheetId, token, tab) {
  const range = encodeURIComponent(`${tab}!A2:H`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to read sheet: ${await res.text()}`);
  return (await res.json()).values || [];
}
async function batchWrite(sheetId, token, data) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  if (!res.ok) throw new Error(`Failed to write sheet: ${await res.text()}`);
}
async function searchPexels(query, apiKey) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const photo = data.photos && data.photos[0];
  if (!photo) return null;
  return { imageUrl: photo.src.landscape || photo.src.large, pageUrl: photo.url, photographer: photo.photographer };
}
const STOPWORDS = new Set(['a','an','the','of','in','on','at','to','from','by','with','is','was','are','were','be','been','being','this','that','these','those','which','who','whom','whose','what','when','where','why','how','does','did','do','has','have','had','its',"it's",'as','and','or','but','if','than','then','not','following','called','known','named','name','also','one','out','for','used','use','can','could','would','should','into','about','first','very','made','make']);
function buildSearchQuery(t) {
  return t.replace(/[?"“”'’.,!]/g, '').toLowerCase().split(/\s+/).filter(w => w && !STOPWORDS.has(w)).slice(0, 6).join(' ').trim();
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error(err); process.exit(1); });
