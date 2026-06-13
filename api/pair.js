// Card ID pairing: links a buy leg + sell leg into a RIP-#### card,
// stores structured identity (grading company, cert, serial, player...),
// and computes true per-card ROI.
// GET  /api/pair?key=APP_SECRET            -> list cards
// POST /api/pair?key=APP_SECRET  {body}    -> create a pairing
// POST /api/pair?key=APP_SECRET&update=ID  -> update a card's identity fields
// POST /api/pair?key=APP_SECRET&unpair=ID  -> remove a pairing

module.exports = async (req, res) => {
  if (req.query.key !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const SB = process.env.SUPABASE_URL;
  const SBK = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const H = {
    'apikey': SBK,
    'Authorization': 'Bearer ' + SBK,
    'Content-Type': 'application/json'
  };

  async function getTxn(id) {
    if (!id) return null;
    const r = await fetch(SB + '/rest/v1/transactions?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: H });
    const a = await r.json();
    return a[0] || null;
  }

  // ---- list cards ----
  if (req.method === 'GET') {
    try {
      const r = await fetch(SB + '/rest/v1/cards?select=*&order=created_at.desc', { headers: H });
      const cards = await r.json();
      return res.status(200).json({ ok: true, cards: cards });
    } catch (e) {
      return res.status(500).json({ error: 'list failed', detail: String(e) });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  // ---- update a card's identity fields ----
  if (req.query.update) {
    const id = req.query.update;
    const b = req.body || {};
    const patch = {};
    ['title','grading_company','grade','cert_number','serial','player','year','set_name','card_number','parallel'].forEach(function (k) {
      if (b[k] !== undefined) patch[k] = (b[k] === '' ? null : b[k]);
    });
    try {
      const r = await fetch(SB + '/rest/v1/cards?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: Object.assign({}, H, { 'Prefer': 'return=representation' }),
        body: JSON.stringify(patch)
      });
      if (!r.ok) return res.status(500).json({ error: 'update failed', detail: await r.text() });
      const out = await r.json();
      return res.status(200).json({ ok: true, card: out[0] });
    } catch (e) {
      return res.status(500).json({ error: 'update crashed', detail: String(e) });
    }
  }

  // ---- unpair ----
  if (req.query.unpair) {
    const cardId = req.query.unpair;
    try {
      await fetch(SB + '/rest/v1/transactions?card_id=eq.' + encodeURIComponent(cardId), {
        method: 'PATCH', headers: H, body: JSON.stringify({ card_id: null })
      });
      await fetch(SB + '/rest/v1/cards?id=eq.' + encodeURIComponent(cardId), {
        method: 'DELETE', headers: H
      });
      return res.status(200).json({ ok: true, unpaired: cardId });
    } catch (e) {
      return res.status(500).json({ error: 'unpair failed', detail: String(e) });
    }
  }

  // ---- create pairing ----
  const b = req.body || {};
  const buyId = b.buy_txn_id || null;
  const sellId = b.sell_txn_id || null;
  const otherCost = Math.abs(parseFloat(b.other_cost) || 0);
  const gradingCost = Math.abs(parseFloat(b.grading_cost) || 0); // optional; grading usually rides on the buy's fees
  if (!buyId && !sellId) {
    return res.status(400).json({ error: 'need at least a buy or a sell transaction' });
  }

  try {
    const buy = await getTxn(buyId);
    const sell = await getTxn(sellId);

    // cost basis = |buy price| + buy grading fees + other cost + (optional linker grading)
    let costBasis = otherCost + gradingCost;
    if (buy) {
      costBasis += Math.abs(Number(buy.gross_amount) || 0)
        + Math.abs(Number(buy.fees) || 0)
        + Math.abs(Number(buy.shipping) || 0);
    }
    const netProceeds = sell ? (Number(sell.net_amount) || 0) : 0;
    const realized = (sell && buy) ? (netProceeds - costBasis) : null;

    let holdingDays = null;
    const acquired = buy ? buy.txn_date : null;
    const sold = sell ? sell.txn_date : null;
    if (acquired && sold) {
      holdingDays = Math.round((new Date(sold) - new Date(acquired)) / (24 * 3600 * 1000));
    }

    const ripRes = await fetch(SB + '/rest/v1/cards?select=rip_id', { headers: H });
    const existing = await ripRes.json();
    let maxN = 0;
    existing.forEach(function (c) {
      const m = (c.rip_id || '').match(/RIP-(\d+)/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    const ripId = 'RIP-' + String(maxN + 1).padStart(4, '0');

    const title = b.title || (sell && sell.description) || (buy && buy.description) || 'Untitled card';
    const image = (sell && sell.image_url) || (buy && buy.image_url) || null;

    const cardRow = {
      rip_id: ripId,
      title: title,
      grading_company: b.grading_company || null,
      grade: b.grade || null,
      cert_number: b.cert_number || null,
      serial: b.serial || null,
      player: b.player || null,
      year: b.year || null,
      set_name: b.set_name || null,
      card_number: b.card_number || null,
      parallel: b.parallel || null,
      buy_txn_id: buyId,
      sell_txn_id: sellId,
      grading_cost: gradingCost,
      other_cost: otherCost,
      cost_basis: Math.round(costBasis * 100) / 100,
      net_proceeds: Math.round(netProceeds * 100) / 100,
      realized_gain: realized === null ? null : Math.round(realized * 100) / 100,
      acquired_at: acquired,
      sold_at: sold,
      holding_days: holdingDays,
      image_url: image,
      status: (buy && sell) ? 'closed' : 'open'
    };

    const cardRes = await fetch(SB + '/rest/v1/cards', {
      method: 'POST',
      headers: Object.assign({}, H, { 'Prefer': 'return=representation' }),
      body: JSON.stringify(cardRow)
    });
    if (!cardRes.ok) {
      return res.status(500).json({ error: 'card create failed', detail: await cardRes.text() });
    }
    const saved = (await cardRes.json())[0];

    const tagIds = [buyId, sellId].filter(Boolean);
    for (let i = 0; i < tagIds.length; i++) {
      await fetch(SB + '/rest/v1/transactions?id=eq.' + encodeURIComponent(tagIds[i]), {
        method: 'PATCH', headers: H, body: JSON.stringify({ card_id: saved.id })
      });
    }

    return res.status(200).json({ ok: true, card: saved });
  } catch (e) {
    return res.status(500).json({ error: 'pair failed', detail: String(e) });
  }
};
