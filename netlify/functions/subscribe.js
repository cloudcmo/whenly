// netlify/functions/subscribe.js  (Whenly)
// Adds an email address to the Resend segment behind the Friday games
// newsletter (shared with Pub Quiz Daily — "Whenly, pub quiz & more").
// Uses the same Resend model as Pub Quiz Daily: one account-level Audience,
// named groups within it are Segments. New signups become contacts and are
// added to the segment the weekly broadcast targets.
//
// Env vars (set these on the Whenly Netlify site — same values as Pub Quiz Daily):
//   RESEND_API_KEY      – your Resend API key
//   RESEND_SEGMENT_ID   – the Friday newsletter segment id
//
// A Whenly-branded welcome email goes to genuinely new contacts. Set
// SEND_WELCOME to false to add subscribers silently.
const SEND_WELCOME = true;

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const SEGMENT_ID     = process.env.RESEND_SEGMENT_ID;

  if (!RESEND_API_KEY || !SEGMENT_ID) {
    console.error('Missing RESEND_API_KEY or RESEND_SEGMENT_ID');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let email;
  try {
    email = JSON.parse(event.body || '{}').email;
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
  }

  const cleanEmail = email.toLowerCase().trim();
  const auth = { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' };

  try {
    // 1. Create the contact (account-level). Treat an existing contact as OK.
    const createRes = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ email: cleanEmail, unsubscribed: false }),
    });
    const createData = await createRes.json().catch(() => ({}));

    const alreadyExists =
      createRes.status === 409 ||
      (createData && typeof createData.message === 'string' && /already/i.test(createData.message));

    if (!createRes.ok && !alreadyExists) {
      console.error('Resend contact error:', createData);
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Could not subscribe' }) };
    }

    // 2. Ensure they're in the newsletter segment (idempotent).
    const segRes = await fetch(
      `https://api.resend.com/contacts/${encodeURIComponent(cleanEmail)}/segments/${SEGMENT_ID}`,
      { method: 'POST', headers: auth }
    );
    if (!segRes.ok) {
      console.error('Add-to-segment failed:', await segRes.text());
    }

    // 3. Welcome email for genuinely new contacts only. Never fail the signup on this.
    if (SEND_WELCOME && createRes.ok && !alreadyExists) {
      await sendWelcome(RESEND_API_KEY, cleanEmail).catch(err =>
        console.error('Welcome email failed (subscription still succeeded):', err)
      );
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('Subscribe error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};

async function sendWelcome(apiKey, email) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#faf9f7;font-family:'DM Sans',system-ui,sans-serif;margin:0;padding:40px 24px;color:#1a1a1a;">
  <div style="max-width:520px;margin:0 auto;">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;margin-bottom:6px;">Whenly</div>
    <div style="font-size:13px;color:#6b6b6b;margin-bottom:28px;">🍺 You're on the list</div>

    <div style="background:white;border:1px solid #e0ddd8;border-radius:12px;padding:28px 26px;">
      <div style="font-family:Georgia,serif;font-size:20px;margin-bottom:12px;">You're in — see you Friday.</div>
      <p style="font-size:15px;line-height:1.65;color:#4a4a4a;margin:0 0 14px;">
        Every Friday we send a free games newsletter — the best of Whenly, the pub quiz,
        and a bit more — straight to your inbox for your morning coffee or lunchtime sandwich.
      </p>
      <p style="font-size:15px;line-height:1.65;color:#4a4a4a;margin:0 0 22px;">
        One email a week, never more. Can't wait until Friday? Today's guess-the-year
        round is ready right now.
      </p>
      <a href="https://whenly.co.uk/"
         style="display:inline-block;background:#4a7c59;color:white;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">
        Play today's Whenly →
      </a>
    </div>

    <div style="margin-top:28px;font-size:11px;color:#c8c8c8;text-align:center;">
      Whenly · whenly.co.uk
    </div>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Whenly <hello@pubquizdaily.com>',
      to: [email],
      subject: "You're in — welcome to Whenly 🍺",
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend welcome send failed: ${err}`);
  }
}
