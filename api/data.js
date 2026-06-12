// Serves transaction data to the dashboard.
// Call: /api/data?key=YOUR_APP_SECRET

module.exports = async (req, res) => {
  if (req.query.key !== process.env.APP_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const SB = process.env.SUPABASE_URL;
  const SBK = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const txRes = await fetch(
      SB + '/rest/v1/transactions?select=*&order=txn_date.desc&limit=500',
      {
        headers: {
          'apikey': SBK,
          'Authorization': 'Bearer ' + SBK
        }
      }
    );
    const txns = await txRes.json();

    // Summary numbers
    let grossSales = 0, totalFees = 0, net = 0, count = 0;
    txns.forEach(function (t) {
      if (t.txn_type === 'sale') {
        grossSales += Number(t.gross_amount) || 0;
        count++;
      }
      totalFees += Number(t.fees) || 0;
      net += Number(t.net_amount) || 0;
    });

    return res.status(200).json({
      ok: true,
      summary: {
        sales_count: count,
        gross_sales: Math.round(grossSales * 100) / 100,
        total_fees: Math.round(totalFees * 100) / 100,
        net_total: Math.round(net * 100) / 100
      },
      transactions: txns
    });
  } catch (err) {
    return res.status(500).json({ error: 'data fetch crashed', detail: String(err) });
  }
};
