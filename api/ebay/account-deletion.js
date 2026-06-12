// eBay Marketplace Account Deletion notification endpoint.
// GET = eBay's challenge handshake. POST = a user deleted their eBay account.
const crypto = require('crypto');

module.exports = async (req, res) => {
  const VERIFICATION_TOKEN = process.env.EBAY_VERIFICATION_TOKEN;
  const ENDPOINT_URL = 'https://ripster-tau.vercel.app/api/ebay/account-deletion';

  // --- Challenge handshake ---
  if (req.method === 'GET') {
    const challengeCode = req.query.challenge_code;
    if (!challengeCode) return res.status(400).json({ error: 'missing challenge_code' });

    const hash = crypto.createHash('sha256');
    hash.update(challengeCode);
    hash.update(VERIFICATION_TOKEN);
    hash.update(ENDPOINT_URL);

    return res.status(200).json({ challengeResponse: hash.digest('hex') });
  }

  // --- Deletion notification ---
  if (req.method === 'POST') {
    try {
      const ebayUserId = req.body?.notification?.data?.userId;
      if (ebayUserId) {
        await fetch(
          process.env.SUPABASE_URL + '/rest/v1/platform_connections?ebay_user_id=eq.' + encodeURIComponent(ebayUserId),
          {
            method: 'DELETE',
            headers: {
              'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY
            }
          }
        );
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('Deletion handling error:', err);
      return res.status(200).json({ ok: true }); // always 200 so eBay doesn't disable the keyset
    }
  }

  return res.status(405).json({ error: 'method not allowed' });
};
