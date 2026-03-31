// netlify/functions/stats.js
// Returns stats for all dates — password protected

exports.handler = async function(event) {
  const headers = { 'Content-Type': 'application/json' };

  const STATS_PASSWORD = process.env.STATS_PASSWORD;
  const supplied       = event.queryStringParameters?.password;

  if (!STATS_PASSWORD || supplied !== STATS_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorised' }) };
  }

  const SITE_ID = process.env.NETLIFY_SITE_ID;
  const TOKEN   = process.env.NETLIFY_API_TOKEN;

  if (!SITE_ID || !TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing env vars' }) };
  }

  const authHeader = { 'Authorization': `Bearer ${TOKEN}` };

  try {
    const listUrl = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats`;
    const listRes = await fetch(listUrl, { headers: authHeader });

    if (!listRes.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to list blobs' }) };
    }

    const listData = await listRes.json();
    const blobs    = listData.blobs || [];

    const rawResults = await Promise.all(
      blobs.map(async blob => {
        const key = blob.key;
        try {
          const res = await fetch(
            `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats/${key}`,
            { headers: authHeader }
          );
          if (!res.ok) return null;
          const data  = await res.json();
          const parts = key.split('-');
          const date  = parts.slice(0, 3).join('-');
          const index = parts.length === 4 ? parseInt(parts[3]) : 0;
          return {
            key, date, index,
            total:        data.total        || 0,
            totalDiff:    data.totalDiff    || 0,
            perfectCount: data.perfectCount || 0,
            avgDiff:      data.avgDiff      || 0,
          };
        } catch { return null; }
      })
    );

    // Group by date
    const byDate = {};
    rawResults.filter(Boolean).forEach(r => {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });

    const results = Object.entries(byDate).map(([date, qs]) => {
      qs.sort((a, b) => a.index - b.index);
      const players     = Math.max(...qs.map(q => q.total));
      const totalDiff   = qs.reduce((s, q) => s + q.totalDiff, 0);
      const totalPlays  = qs.reduce((s, q) => s + q.total, 0);
      const avgDiff     = totalPlays > 0 ? Math.round(totalDiff / totalPlays) : 0;
      const avgScore    = Math.max(0, 50 - avgDiff);
      return {
        date, players, avgScore, avgDiff,
        questions: qs.map(q => ({
          index: q.index, total: q.total,
          perfectCount: q.perfectCount, avgDiff: q.avgDiff,
        })),
      };
    });

    results.sort((a, b) => b.date.localeCompare(a.date));

    // Fetch share counts
    const shares = {};
    await Promise.all(results.map(async r => {
      try {
        const res = await fetch(
          `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-shares/daily-${r.date}`,
          { headers: authHeader }
        );
        if (res.ok) {
          const data = await res.json();
          shares[r.date] = data.count || 0;
        }
      } catch {}
    }));

    results.forEach(r => { r.shares = shares[r.date] || 0; });

    return { statusCode: 200, headers, body: JSON.stringify({ stats: results }) };

  } catch (e) {
    console.error('Stats error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
