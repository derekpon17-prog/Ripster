// Exchanges eBay's authorization code for tokens and stores them in Supabase.
const crypto = require('crypto');

module.exports = async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.redirect(302, '/?ebay=declined');
  }

  const ENV = process.env.EBAY_ENV || 'SANDBOX';
  const base = ENV === 'PRODUCTION' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
  const auth = Buffer.from(process.env.EBAY_APP_ID + ':' + process.env.EBAY_CERT_ID).toString('base64');

  try {
    // 1. Exchange code for tokens
    const tokenRes = await fetch(base + '/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + auth
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.EBAY_RUNAME
      })
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      console.error('Token exchange failed:', tokens);
      return res.redirect(302, '/?ebay=error');
    }

    // 2. Store in Supabase (service role key bypasses RLS — server-side only)
    const now = Date.now();
    const row = {
      platform: 'ebay',
      environment: ENV.toLowerCase(),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      access_expires_at: new Date(now + (tokens.expires_in || 7200) * 1000).toISOString(),
      refresh_expires_at: tokens.refresh_token_expires_in
        ? new Date(now + tokens.refresh_token_expires_in * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString()
    };

    const sbRes = await fetch(process.env.SUPABASE_URL + '/rest/v1/platform_connections', {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });

    if (!sbRes.ok) {
      console.error('Supabase insert failed:', await sbRes.text());
      return res.redirect(302, '/?ebay=storage_error');
    }

    return res.redirect(302, '/?ebay=connected');
  } catch (err) {
    console.error('Callback error:', err);
    return res.redirect(302, '/?ebay=error');
  }
};
