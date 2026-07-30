#!/usr/bin/env node
// scripts/harden-windows.js  (Whenly)
//
// Repositions each question's [min, max] window so the correct answer no longer
// sits in the MIDDLE of the range. It keeps each question's window WIDTH exactly
// as authored, but slides the window so the answer lands at a varied, off-centre
// position (deterministic per question, so re-running is a no-op). This stops the
// slider's default midpoint from being a free near-perfect guess.
//
// Reads and rewrites whenly-question-drafts.json in place. Then run
//   npm run update-windows
// to push the new min/max to the live sheet.
//
//   node scripts/harden-windows.js            apply
//   node scripts/harden-windows.js --dry-run  preview stats only

const fs = require('fs');
const path = require('path');

const DRAFTS_PATH = path.join(__dirname, '..', 'whenly-question-drafts.json');
const DRY_RUN = process.argv.slice(2).includes('--dry-run');

const CURRENT_YEAR = 2026;
// Off-centre target positions for the answer within [min,max] (0 = min, 1 = max).
// Deliberately avoids the 0.4–0.6 dead-centre band and both hard edges, and mixes
// early- and late-in-range so there's no learnable bias.
const FRACS = [0.16, 0.22, 0.28, 0.34, 0.66, 0.72, 0.78, 0.84];

function hashStr(s) {
  let h = 0;
  s = (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function reposition(A, w) {
  const frac = FRACS[hashStr('' + A + '|' + w) % FRACS.length];
  let min = Math.round(A - frac * w);
  let max = min + w;
  // Never let the range run past the present day.
  if (max > CURRENT_YEAR) { max = CURRENT_YEAR; min = max - w; }
  // Keep the answer at least a couple of years off each edge (never on the rail).
  const edge = Math.max(2, Math.round(w * 0.08));
  if (A - min < edge) { min = A - edge; max = min + w; }
  if (max - A < edge) { max = A + edge; min = max - w; }
  if (max > CURRENT_YEAR) { max = CURRENT_YEAR; min = max - w; }
  return { min, max };
}

function main() {
  const drafts = JSON.parse(fs.readFileSync(DRAFTS_PATH, 'utf8'));
  let changed = 0;
  const before = [], after = [];

  for (const d of drafts) {
    const A = +d.answer, min0 = +d.min, max0 = +d.max;
    if (!(max0 > min0) || isNaN(A)) continue;
    const w = max0 - min0;
    before.push(Math.abs(A - (min0 + max0) / 2));
    const { min, max } = reposition(A, w);
    after.push(Math.abs(A - (min + max) / 2));
    if (min !== min0 || max !== max0) { d.min = min; d.max = max; changed++; }
  }

  const nearMid = arr => arr.filter(x => x <= 3).length;
  console.log('');
  console.log(`Questions: ${drafts.length}`);
  console.log(`Answers within 3yrs of midpoint  BEFORE: ${nearMid(before)} (${Math.round(nearMid(before)/before.length*100)}%)  AFTER: ${nearMid(after)} (${Math.round(nearMid(after)/after.length*100)}%)`);
  console.log(`${DRY_RUN ? '[DRY RUN] Would reposition' : 'Repositioned'} ${changed} window(s). Widths unchanged.`);

  if (!DRY_RUN) {
    fs.writeFileSync(DRAFTS_PATH, JSON.stringify(drafts, null, 2) + '\n');
    console.log('Saved whenly-question-drafts.json. Now run:  npm run update-windows');
  }
}

main();
