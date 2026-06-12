// Adds a manual transaction (PayPal, Venmo, Fanatics, card shows, cash).
// POST /api/manual?key=APP_SECRET  with JSON body.

module.exports = async (req, res) => {
  if (req.query.key !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const b = req.body || {};
  const gross = Math.abs(parseFloat(b.gross) || 0);
  const fees = Math.abs(parseFloat(b.fees) || 0);
  const shipping = Math.abs(parseFloat(b.shipping) || 0);
  const isSale = b.txn_type === 'sale';

  const row = {
    platform: b.platform || 'manual',
    platform_txn_id: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    txn_type: isSale ? 'sale' : 'purchase',
    txn_date: b.txn_date ? new Date(b.txn_date).toISOString() : new Date().toISOString(),
    description: b.description || 'Manual entry',
    gross_amount: isSale ? gross : -gross,
    fees: fees,
    shipping: shipping,
    net_amount: isSale ? gross - fees - shipping : -(gross + fees + shipping),
    raw: b,
    is_card: true,
    needs_review: false
  };

  try {
    const sbRes = await fetch(process.env.SUPABASE_URL + '/rest/v1/transactions', {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(row)
    });
    if (!sbRes.ok) {
      return res.status(500).json({ error: 'insert failed', detail: await sbRes.text() });
    }
    const saved = await sbRes.json();
    return res.status(200).json({ ok: true, transaction: saved[0] });
  } catch (err) {
    return res.status(500).json({ error: 'crashed', detail: String(err) });
  }
};
