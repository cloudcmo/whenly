// netlify/functions/record-answer.js
// Records year guesses and returns stats using Netlify Blobs REST API
// Blob key format: whenly-stats/YYYY-MM-DD-N (where N is question index)
// Stores: total plays, sum of points lost, perfect count, and offsets {guess - answer: count}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const SITE_ID = process.env.NETLIFY_SITE_ID;
  const TOKEN   = process.env.NETLIFY_API_TOKEN;

  if (!SITE_ID || !TOKEN) {
    console.error('Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN');
    return { statusCode: 200, headers, body: JSON.stringify({ total: 0, avgDiff: 0 }) };
  }

  const authHeader = { 'Authorization': `Bearer ${TOKEN}` };

  let date, index;

  if (event.httpMethod === 'GET') {
    date  = event.queryStringParameters?.date  || todayISO();
    index = event.queryStringParameters?.index ?? '0';
  } else {
    try {
      const body = JSON.parse(event.body || '{}');
      date  = body.date  || todayISO();
      index = body.index ?? 0;
    } catch {
      date  = todayISO();
      index = 0;
    }
  }

  const blobKey = `${date}-${index}`;
  const blobUrl = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats/${blobKey}`;

  // GET — fetch current stats for this question
  if (event.httpMethod === 'GET') {
    try {
      const res = await fetch(blobUrl, { headers: authHeader });
      if (res.status === 404) {
        return { statusCode: 200, headers, body: JSON.stringify({ total: 0, totalDiff: 0, avgDiff: 0, perfectCount: 0 }) };
      }
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    } catch (e) {
      console.error('GET error:', e);
      return { statusCode: 200, headers, body: JSON.stringify({ total: 0, totalDiff: 0, avgDiff: 0, perfectCount: 0 }) };
    }
  }

  // POST — record a new guess
  if (event.httpMethod === 'POST') {
    let diff = 0, offset = null;
    try {
      const body = JSON.parse(event.body || '{}');
      diff = parseInt(body.diff) || 0;
      // Signed guess minus answer, so the reveal can show where everyone guessed (10 Oct 2026)
      const o = parseInt(body.offset);
      if (Number.isFinite(o) && Math.abs(o) <= 300) offset = o;
    } catch {}

    try {
      let stats = { total: 0, totalDiff: 0, perfectCount: 0 };
      const getRes = await fetch(blobUrl, { headers: authHeader });
      if (getRes.ok) stats = await getRes.json();

      stats.total     += 1;
      stats.totalDiff += diff;
      if (diff === 0) stats.perfectCount = (stats.perfectCount || 0) + 1;
      if (offset !== null) {
        stats.offsets = stats.offsets || {};
        stats.offsets[offset] = (stats.offsets[offset] || 0) + 1;
      }
      stats.avgDiff = Math.round(stats.totalDiff / stats.total);

      await fetch(blobUrl, {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(stats),
      });

      return { statusCode: 200, headers, body: JSON.stringify(stats) };
    } catch (e) {
      console.error('POST error:', e);
      return { statusCode: 200, headers, body: JSON.stringify({ total: 0, totalDiff: 0, avgDiff: 0, perfectCount: 0 }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
