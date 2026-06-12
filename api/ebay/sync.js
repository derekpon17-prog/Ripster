// Pulls real transactions from eBay's Finances API into Supabase.
// Call: /api/ebay/sync?key=YOUR_APP_SECRET

module.exports = async (req, res) => {
  if (req.query.key !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const SB = process.env.SUPABASE_URL;
  const SBK = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbHeaders = {
    'apikey': SBK,
    'Authorization': 'Bearer ' + SBK,
    'Content-Type': 'application/json'
  };

  try {
    // 1. Get the newest production connection
    const connRes = await fetch(
      SB + '/rest/v1/platform_connections?environment=eq.production&order=created_at.desc&limit=1',
      { headers: sbHeaders }
    );
    const conns = await connRes.json();
    if (!conns.length) return res.status(400).json({ error: 'no production connection found' });
    let conn = conns[0];

    // 2. Refresh the access token if it expires within 5 minutes
    if (new Date(conn.access_expires_at).getTime() < Date.now() + 5 * 60 * 1000) {
      const basic = Buffer.from(process.env.EBAY_APP_ID + ':' + process.env.EBAY_CERT_ID).toString('base64');
      const refRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + basic
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: conn.refresh_token
        })
      });
      const ref = await refRes.json();
      if (!ref.access_token) {
        return res.status(401).json({ error: 'token refresh failed', detail: ref });
      }
      conn.access_token = ref.access_token;
      await fetch(SB + '/rest/v1/platform_connections?id=eq.' + conn.id, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify({
          access_token: ref.access_token,
          access_expires_at: new Date(Date.now() + (ref.expires_in || 7200) * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      });
    }

    // 3. Pull transactions from eBay Finances API (last 90 days, up to 1000)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    let allTxns = [];
    let offset = 0;
    const LIMIT = 200;

    for (let page = 0; page < 5; page++) {
      const url = 'https://apiz.ebay.com/sell/finances/v1/transaction'
        + '?limit=' + LIMIT + '&offset=' + offset
        + '&filter=' + encodeURIComponent('transactionDate:[' + ninetyDaysAgo + '..' + nowIso + ']');
      const txRes = await fetch(url, {
        headers: { 'Authorization': 'Bearer ' + conn.access_token }
      });
      const txData = await txRes.json();
      if (!txRes.ok) {
        return res.status(txRes.status).json({ error: 'ebay finances call failed', detail: txData });
      }
      const batch = txData.transactions || [];
      allTxns = allTxns.concat(batch);
      if (batch.length < LIMIT) break;
      offset += LIMIT;
    }

    // 4. Map to our schema and upsert
    const rows = allTxns.map(function (t) {
      const gross = t.amount ? parseFloat(t.amount.value) : 0;
      const fees = t.totalFeeAmount ? parseFloat(t.totalFeeAmount.value) : 0;
      const isCredit = t.bookingEntry === 'CREDIT';
      return {
        connection_id: conn.id,
        platform: 'ebay',
        platform_txn_id: t.transactionId,
        txn_type: (t.transactionType || '').toLowerCase(),
        txn_date: t.transactionDate,
        description: (t.transactionMemo || t.transactionType || '') +
          (t.orderId ? ' · order ' + t.orderId : ''),
        gross_amount: isCredit ? gross : -gross,
        fees: fees,
        shipping: 0,
        net_amount: isCredit ? gross - fees : -gross,
        raw: t,
        is_card: true,
        needs_review: false
      };
    });

    let inserted = 0;
    if (rows.length) {
      const upRes = await fetch(
        SB + '/rest/v1/transactions?on_conflict=platform_txn_id',
        {
          method: 'POST',
          headers: Object.assign({}, sbHeaders, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
          body: JSON.stringify(rows)
        }
      );
      if (!upRes.ok) {
        return res.status(500).json({ error: 'supabase upsert failed', detail: await upRes.text() });
      }
      inserted = rows.length;
    }

    return res.status(200).json({
      ok: true,
      pulled_from_ebay: allTxns.length,
      upserted: inserted,
      window_days: 90
    });
  } catch (err) {
    return res.status(500).json({ error: 'sync crashed', detail: String(err) });
  }
};
