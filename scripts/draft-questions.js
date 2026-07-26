#!/usr/bin/env node
// scripts/draft-questions.js  (Whenly)
//
// Appends a batch of guess-the-year questions into the Whenly Google Sheet.
// Reads them from whenly-question-drafts.json in the repo root — an array of:
//   { date, category, question, answer, min, max, explainer, image? }
//
// Sheet columns are:  A date | B category | C question | D image | E answer |
//                     F min  | G max      | H explainer
// (image is left blank here — scripts/add-images.js fills it from Pexels.)
//
// SAFETY
//   • Appends new rows only — never edits or overwrites an existing row.
//   • De-dupes: a draft whose (date + question) already exists in the sheet
//     is skipped, so re-running the same batch can't create duplicates.
//   • --dry-run shows exactly what it would append and writes nothing.
//
// Reuses the SAME image-search.config.json as add-images.js
// (sheetId + googleServiceAccount with Editor access). No new setup.
//
//   node scripts/draft-questions.js            append the drafts
//   node scripts/draft-questions.js --dry-run  preview only

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'image-search.config.json');
const DRAFTS_PATH = path.join(__dirname, '..', 'whenly-question-drafts.json');
const DRY_RUN = process.argv.slice(2).includes('--dry-run');

async function main() {
  const config = loadConfig(['sheetId', 'googleServiceAccount']);
  const drafts = JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8'));
  if (!Array.isArray(drafts) || !drafts.length) {
    console.error(`No drafts found in ${path.basename(DRAFTS_PATH)}`);
    process.exit(1);
  }

  const token = await getAccessToken(config.googleServiceAccount);
  const tab = await getFirstTabTitle(config.sheetId, token);
  const rows = await fetchRows(config.sheetId, token, tab); // A2:H

  const seen = new Set(
    rows.filter(r => (r[0] || '').trim() && (r[2] || '').trim())
        .map(r => `${(r[0] || '').trim()}||${(r[2] || '').trim()}`)
  );

  const toAppend = [];
  const skipped = [];
  for (const d of drafts) {
    const key = `${(d.date || '').trim()}||${(d.question || '').trim()}`;
    if (seen.has(key)) { skipped.push(`${d.date} — "${(d.question || '').slice(0, 45)}…" already in sheet`); continue; }
    seen.add(key);
    // A..H  (image column D left blank for the Pexels step)
    toAppend.push([d.date, d.category, d.question, d.image || '', d.answer, d.min, d.max, d.explainer]);
  }

  console.log('');
  console.log(`${DRY_RUN ? '[DRY RUN] Would append' : 'Appending'} ${toAppend.length} row(s) to tab "${tab}".`);
  if (DRY_RUN) toAppend.forEach(r => console.log(`   ${r[0]}  ${String(r[4])}  ${r[1]} — ${String(r[2]).slice(0, 50)}`));

  if (!DRY_RUN && toAppend.length) {
    await appendRows(config.sheetId, token, tab, toAppend);
    console.log('Done. Open the sheet to review.');
  }
  if (skipped.length) {
    console.log('');
    console.log(`Skipped ${skipped.length} duplicate(s):`);
    skipped.forEach(s => console.log(`  ${s}`));
  }
}

function loadConfig(required) {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Missing ${CONFIG_PATH} — copy image-search.config.example.json and fill it in.`);
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of required) if (!c[k]) { console.error(`config is missing "${k}"`); process.exit(1); }
  return c;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  const unsigned = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(claim)))}`;
  const signer = crypto.createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const jwt = `${unsigned}.${base64url(signer.sign(sa.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google auth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}
async function getFirstTabTitle(sheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to read spreadsheet metadata: ${await res.text()}`);
  const sheets = (await res.json()).sheets || [];
  const first = sheets.find(s => s.properties && s.properties.sheetId === 0) || sheets[0];
  if (!first) throw new Error('No tabs found in spreadsheet');
  return first.properties.title;
}
async function fetchRows(sheetId, token, tab) {
  const range = encodeURIComponent(`${tab}!A2:H`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to read sheet: ${await res.text()}`);
  return (await res.json()).values || [];
}
async function appendRows(sheetId, token, tab, values) {
  const range = encodeURIComponent(`${tab}!A1`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!res.ok) throw new Error(`Failed to append rows: ${await res.text()}`);
}

main().catch(err => { console.error(err); process.exit(1); });
