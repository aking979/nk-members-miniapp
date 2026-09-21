const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) return res.status(500).json({ error: 'YooKassa is not configured' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const telegramId = String(body.telegram_id || '').slice(0, 64);
    const username = String(body.username || '').replace(/^@/, '').slice(0, 64);

    const payload = {
      amount: { value: '4900.00', currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: `${origin}/?payment_return=1`
      },
      description: 'Резидентство NK — 1 месяц',
      save_payment_method: true,
      metadata: {
        product: 'nk_members_monthly',
        ...(telegramId ? { telegram_id: telegramId } : {}),
        ...(username ? { telegram_username: username } : {})
      }
    };

    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`,
        'Idempotence-Key': crypto.randomUUID(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.description || data.code || 'YooKassa error', details: data });

    return res.status(200).json({
      payment_id: data.id,
      status: data.status,
      confirmation_url: data.confirmation?.confirmation_url || null
    });
  } catch (error) {
    return res.status(500).json({ error: 'Не удалось создать платеж', details: String(error?.message || error) });
  }
};
