#!/usr/bin/env node
// scripts/replace-upcoming.js  (Whenly)
//
// Rewrites the questions for whole future days in the live sheet from
// whenly-upcoming.json. For each date in that file it finds the rows in the
// sheet with that date (column A) and overwrites columns B to H (category,
// question, image, answer, min, max, explainer). The date column and the row
// order are never touched, and no rows are added or deleted.
//
// Safety:
//   - today's and earlier dates are never changed, so a game in progress is safe
//   - a date is skipped (with a warning) unless the sheet has exactly as many
//     rows for it as the file does
//   - the whole sheet is saved to backups/ before anything is written
//   - a question that was already in the sheet keeps its existing image; new
//     questions get a blank image, ready for `npm run add-images`
//
//   node scripts/replace-upcoming.js --dry-run   preview only, writes nothing
//   node scripts/replace-upcoming.js             apply

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'image-search.config.json');
const DATA_PATH = path.join(ROOT, 'whenly-upcoming.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const DRY_RUN = process.argv.slice(2).includes('--dry-run');

function londonToday() {
  // YYYY-MM-DD in UK time, matching what players see
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function main() {
  const config = loadConfig(['sheetId', 'googleServiceAccount']);
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const today = londonToday();

  // Group the new questions by date, in file order.
  const byDate = new Map();
  for (const q of data) {
    for (const k of ['date', 'category', 'question', 'answer', 'min', 'max', 'explainer']) {
      if (q[k] === undefined || q[k] === '') throw new Error(`whenly-upcoming.json: "${k}" missing in ${JSON.stringify(q).slice(0, 120)}`);
    }
    if (!(+q.min < +q.answer && +q.answer < +q.max)) throw new Error(`Answer outside its window: ${q.question}`);
    if (!byDate.has(q.date)) byDate.set(q.date, []);
    byDate.get(q.date).push(q);
  }

  const token = await getAccessToken(config.googleServiceAccount);
  const tab = await getFirstTabTitle(config.sheetId, token);
  const rows = await fetchRows(config.sheetId, token, tab); // index 0 = sheet row 2

  // Keep any image already attached to a question we are re-using.
  const imageByQ = new Map();
  rows.forEach(r => { if ((r[2] || '').trim() && (r[3] || '').trim()) imageByQ.set(norm(r[2]), r[3]); });

  const updates = [];
  const report = [];
  let skippedPast = 0, skippedCount = 0, keptImages = 0;

  for (const [date, qs] of byDate) {
    if (date <= today) { skippedPast++; continue; }
    const idx = [];
    rows.forEach((r, i) => { if ((r[0] || '').trim() === date) idx.push(i); });
    if (idx.length !== qs.length) {
      console.warn(`  ! ${date}: sheet has ${idx.length} row(s), file has ${qs.length}. Skipped.`);
      skippedCount++;
      continue;
    }
    qs.forEach((q, j) => {
      const i = idx[j];
      const img = imageByQ.get(norm(q.question)) || '';
      if (img) keptImages++;
      const old = (rows[i][2] || '').trim();
      updates.push({ range: `${tab}!B${i + 2}:H${i + 2}`, values: [[q.category, q.question, img, +q.answer, +q.min, +q.max, q.explainer]] });
      report.push(`${date}  ${String(q.answer).padEnd(5)} ${q.question.slice(0, 70)}${old && norm(old) !== norm(q.question) ? `\n${' '.repeat(18)}(was: ${old.slice(0, 60)})` : ''}`);
    });
  }

  console.log('');
  console.log(report.join('\n'));
  console.log('');
  console.log(`Today (UK) is ${today}. Days before or on today left alone: ${skippedPast}.`);
  if (skippedCount) console.log(`Days skipped because the row count did not match: ${skippedCount}.`);
  console.log(`${DRY_RUN ? '[DRY RUN] Would rewrite' : 'Rewriting'} ${updates.length} row(s); ${keptImages} keep their existing image.`);

  if (DRY_RUN || !updates.length) return;

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `sheet-backup-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ tab, rows }, null, 2));
  console.log(`Backed up the current sheet to ${path.relative(ROOT, backupPath)}`);

  await batchWrite(config.sheetId, token, updates);
  console.log('Done. Now run:  npm run add-images');
}

function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function loadConfig(required) {
  if (!fs.existsSync(CONFIG_PATH)) { console.error(`Missing ${CONFIG_PATH}`); process.exit(1); }
  const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of required) if (!c[k]) { console.error(`config is missing "${k}"`); process.exit(1); }
  return c;
}
function base64url(b){return b.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function getAccessToken(sa){
  const now=Math.floor(Date.now()/1000);
  const unsigned=`${base64url(Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})))}.${base64url(Buffer.from(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',exp:now+3600,iat:now})))}`;
  const signer=crypto.createSign('RSA-SHA256');signer.update(unsigned);signer.end();
  const jwt=`${unsigned}.${base64url(signer.sign(sa.private_key))}`;
  const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
  if(!res.ok)throw new Error(`Google auth failed: ${await res.text()}`);
  return (await res.json()).access_token;
}
async function getFirstTabTitle(sheetId,token){
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,{headers:{Authorization:`Bearer ${token}`}});
  if(!res.ok)throw new Error(`Failed to read metadata: ${await res.text()}`);
  const sheets=(await res.json()).sheets||[];
  const first=sheets.find(s=>s.properties&&s.properties.sheetId===0)||sheets[0];
  return first.properties.title;
}
async function fetchRows(sheetId,token,tab){
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${tab}!A2:H`)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!res.ok)throw new Error(`Failed to read sheet: ${await res.text()}`);
  return (await res.json()).values||[];
}
async function batchWrite(sheetId,token,data){
  const res=await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({valueInputOption:'RAW',data})});
  if(!res.ok)throw new Error(`Failed to write: ${await res.text()}`);
}
main().catch(err=>{console.error(err);process.exit(1);});
