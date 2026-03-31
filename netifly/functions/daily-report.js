// netlify/functions/daily-report.js
// Sends a daily stats summary email via Resend
// Scheduled to run at 8am UTC daily

exports.handler = async function(event) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const REPORT_EMAIL   = process.env.DAILY_REPORT_EMAIL;
  const SITE_ID        = process.env.NETLIFY_SITE_ID;
  const TOKEN          = process.env.NETLIFY_API_TOKEN;

  if (!RESEND_API_KEY || !REPORT_EMAIL || !SITE_ID || !TOKEN) {
    console.error('Missing env vars for daily report');
    return { statusCode: 500, body: 'Missing env vars' };
  }

  const authHeader = { 'Authorization': `Bearer ${TOKEN}` };

  // Yesterday's date
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO   = yesterday.toISOString().slice(0, 10);
  const yesterdayLabel = yesterday.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  try {
    // ── Deduplication check — bail if already sent today ──
    const sentKey = `report-sent-${yesterdayISO}`;
    const sentUrl = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-meta/${sentKey}`;
    const alreadySent = await fetch(sentUrl, { headers: authHeader });
    if (alreadySent.ok) {
      console.log(`Report already sent for ${yesterdayISO} — skipping`);
      return { statusCode: 200, body: 'Already sent' };
    }
    // Mark as sent immediately so a second invocation bails out
    await fetch(sentUrl, {
      method: 'PUT',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: true, sentAt: new Date().toISOString() }),
    });

    // ── Fetch yesterday's question stats ──
    let yesterdayPlayers   = 0;
    let yesterdayQuestions = [];

    const listRes = await fetch(
      `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats`,
      { headers: authHeader }
    );

    if (listRes.ok) {
      const listData = await listRes.json();
      const blobs    = (listData.blobs || []).filter(b => b.key.startsWith(yesterdayISO));

      const qStats = await Promise.all(blobs.map(async blob => {
        const res = await fetch(
          `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats/${blob.key}`,
          { headers: authHeader }
        );
        if (!res.ok) return null;
        const data  = await res.json();
        const parts = blob.key.split('-');
        const index = parts.length === 4 ? parseInt(parts[3]) : 0;
        return {
          index,
          total:        data.total        || 0,
          totalDiff:    data.totalDiff    || 0,
          perfectCount: data.perfectCount || 0,
          avgDiff:      data.avgDiff      || 0,
        };
      }));

      const valid = qStats.filter(Boolean).sort((a, b) => a.index - b.index);
      yesterdayPlayers   = valid.length > 0 ? Math.max(...valid.map(q => q.total)) : 0;
      yesterdayQuestions = valid;
    }

    // ── Fetch yesterday's shares ──
    let dailyShares = 0;
    const shareRes = await fetch(
      `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-shares/daily-${yesterdayISO}`,
      { headers: authHeader }
    );
    if (shareRes.ok) {
      const shareData = await shareRes.json();
      dailyShares = shareData.count || 0;
    }

    // ── Fetch all-time totals ──
    let allTimePlayers = 0;
    let activeDays     = 0;
    let allTimeAvgDiff = 0;
    let allTimeTotalDiff = 0;
    let allTimeTotalAnswers = 0;

    const allListRes = await fetch(
      `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats`,
      { headers: authHeader }
    );
    if (allListRes.ok) {
      const allListData = await allListRes.json();
      const allBlobs    = allListData.blobs || [];

      const allStats = await Promise.all(allBlobs.map(async blob => {
        const res = await fetch(
          `https://api.netlify.com/api/v1/blobs/${SITE_ID}/whenly-stats/${blob.key}`,
          { headers: authHeader }
        );
        if (!res.ok) return null;
        const data  = await res.json();
        const parts = blob.key.split('-');
        const date  = parts.slice(0, 3).join('-');
        return { date, total: data.total || 0, totalDiff: data.totalDiff || 0 };
      }));

      const byDate = {};
      allStats.filter(Boolean).forEach(r => {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
      });

      activeDays = Object.keys(byDate).length;
      Object.values(byDate).forEach(qs => {
        allTimePlayers      += Math.max(...qs.map(q => q.total));
        allTimeTotalAnswers += qs.reduce((s, q) => s + q.total, 0);
        allTimeTotalDiff    += qs.reduce((s, q) => s + q.totalDiff, 0);
      });
      allTimeAvgDiff = allTimeTotalAnswers > 0
        ? Math.round(allTimeTotalDiff / allTimeTotalAnswers) : 0;
    }

    // ── Overall avg score yesterday ──
    const yesterdayTotalDiff    = yesterdayQuestions.reduce((s, q) => s + q.totalDiff, 0);
    const yesterdayTotalAnswers = yesterdayQuestions.reduce((s, q) => s + q.total, 0);
    const yesterdayAvgDiff      = yesterdayTotalAnswers > 0
      ? Math.round(yesterdayTotalDiff / yesterdayTotalAnswers) : 0;
    const yesterdayAvgScore     = Math.max(0, 50 - yesterdayAvgDiff);
    const perfectsYesterday     = yesterdayQuestions.reduce((s, q) => s + (q.perfectCount || 0), 0);

    // ── Build per-question rows ──
    const qRows = yesterdayQuestions.map((q, i) => {
      const pct = q.total > 0 ? Math.round((q.perfectCount / q.total) * 100) : 0;
      const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
      const diffColor = q.avgDiff <= 5 ? '#4a7c59' : q.avgDiff <= 15 ? '#c08030' : '#c0622e';
      return `
        <tr style="border-bottom:1px solid #f0ede8;">
          <td style="padding:8px 12px;color:#6b6b6b;font-size:13px;white-space:nowrap;">Q${i + 1}</td>
          <td style="padding:8px 12px;font-size:13px;color:#1a1a1a;">${q.total} plays</td>
          <td style="padding:8px 12px;font-family:monospace;font-size:12px;color:#4a7c59;">${bar} ${pct}% 🎯</td>
          <td style="padding:8px 12px;font-size:13px;font-weight:600;color:${diffColor};">avg −${q.avgDiff}yrs</td>
        </tr>
      `;
    }).join('');

    // ── Build HTML email ──
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#faf9f7;font-family:'DM Sans',system-ui,sans-serif;margin:0;padding:40px 24px;">
  <div style="max-width:560px;margin:0 auto;">

    <div style="margin-bottom:28px;display:flex;align-items:center;gap:12px;">
      <div>
        <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:-0.01em;">Whenly</div>
        <div style="font-size:12px;color:#6b6b6b;letter-spacing:0.05em;text-transform:uppercase;">Daily report — ${yesterdayLabel}</div>
      </div>
    </div>

    <!-- Yesterday summary -->
    <div style="background:white;border:1px solid #e0ddd8;border-radius:12px;padding:24px;margin-bottom:16px;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b6b;margin-bottom:16px;">Yesterday</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:${yesterdayQuestions.length > 0 ? '20px' : '0'};">
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:600;color:#1a1a1a;line-height:1;">${yesterdayPlayers}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Players</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:600;color:#1a1a1a;line-height:1;">${yesterdayAvgScore}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Avg score</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:600;color:#1a1a1a;line-height:1;">${perfectsYesterday}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">🎯 Perfects</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:28px;font-weight:600;color:#1a1a1a;line-height:1;">${dailyShares}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Shares</div>
        </div>
      </div>
      ${yesterdayQuestions.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e0ddd8;">
        <tr style="border-bottom:1px solid #e0ddd8;">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b6b6b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">#</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b6b6b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Plays</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b6b6b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Perfect %</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b6b6b;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;">Avg diff</th>
        </tr>
        ${qRows}
      </table>` : '<p style="font-size:13px;color:#6b6b6b;margin:0;">No plays recorded yet for yesterday.</p>'}
    </div>

    <!-- All time -->
    <div style="background:white;border:1px solid #e0ddd8;border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b6b;margin-bottom:16px;">All time</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:600;color:#1a1a1a;line-height:1;">${allTimePlayers.toLocaleString()}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Total plays</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:600;color:#1a1a1a;line-height:1;">${activeDays}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Active days</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:22px;font-weight:600;color:#1a1a1a;line-height:1;">${Math.max(0, 50 - allTimeAvgDiff)}</div>
          <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">Avg score</div>
        </div>
      </div>
    </div>

    <div style="margin-top:32px;font-size:11px;color:#c8c8c8;text-align:center;">
      Whenly · whenly.co.uk
    </div>

  </div>
</body>
</html>`;

    // ── Send via Resend ──
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Whenly <hello@whenly.co.uk>',
        to:   [REPORT_EMAIL],
        subject: `Whenly — ${yesterdayPlayers} players · avg ${Math.max(0, 50 - yesterdayAvgDiff)}/50 · ${yesterdayLabel}`,
        html,
      }),
    });

    if (!sendRes.ok) {
      const err = await sendRes.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: 'Email send failed' };
    }

    console.log(`Daily report sent for ${yesterdayISO}`);
    return { statusCode: 200, body: 'OK' };

  } catch (e) {
    console.error('Daily report error:', e);
    return { statusCode: 500, body: 'Internal error' };
  }
};
