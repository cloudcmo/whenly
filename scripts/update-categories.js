#!/usr/bin/env node
// scripts/update-categories.js  (Whenly)
//
// Updates ONLY the category (col B) of questions already in the sheet, matching
// each row to whenly-question-drafts.json by its question text. Nothing else is
// touched — dates, questions, images, answers, windows and explainers stay put,
// and no rows are added or deleted. Safe to re-run.
//
//   node scripts/update-categories.js            apply the new categories
//   node scripts/update-categories.js --dry-run  preview only
//
// Reuses image-search.config.json (sheetId + googleServiceAccount, Editor).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', 'image-search.config.json');
const DRAFTS_PATH = path.join(__dirname, '..', 'whenly-question-drafts.json');
const OVERRIDES_PATH = path.join(__dirname, '..', 'category-overrides.json');
const DRY_RUN = process.argv.slice(2).includes('--dry-run');

async function main() {
  const config = loadConfig(['sheetId', 'googleServiceAccount']);
  const drafts = JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8'));
  const byQ = new Map(drafts.map(d => [norm(d.question), d]));

  // Optional: category-overrides.json covers older questions that aren't in the
  // drafts file (question -> category). Overrides win over the drafts mapping.
  if (fs.existsSync(OVERRIDES_PATH)) {
    const overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
    overrides.forEach(o => { if (o && o.question && o.category) byQ.set(norm(o.question), o); });
    console.log(`Loaded ${overrides.length} category override(s) for older questions.`);
  }

  const token = await getAccessToken(config.googleServiceAccount);
  const tab = await getFirstTabTitle(config.sheetId, token);
  const rows = await fetchRows(config.sheetId, token, tab); // index 0 = sheet row 2

  const updates = [];
  let matched = 0, unchanged = 0;
  rows.forEach((r, i) => {
    const q = (r[2] || '').trim();
    if (!q) return;
    const d = byQ.get(norm(q));
    if (!d || !d.category) return;
    matched++;
    const cur = (r[1] || '').toString().trim();
    if (cur === String(d.category)) { unchanged++; return; }
    updates.push({ range: `${tab}!B${i + 2}`, values: [[d.category]] });
  });

  console.log('');
  console.log(`Matched ${matched} question(s) in the sheet; ${unchanged} already correct.`);
  console.log(`${DRY_RUN ? '[DRY RUN] Would update' : 'Updating'} ${updates.length} row(s) (category only).`);

  if (!DRY_RUN && updates.length) {
    await batchWrite(config.sheetId, token, updates);
    console.log('Done. Only the category column (B) was changed.');
  }
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
