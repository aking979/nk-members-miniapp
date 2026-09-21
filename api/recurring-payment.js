const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  const recurringSecret = process.env.NK_RECURRING_SECRET;

  if (!shopId || !secretKey) {
    return res.status(500).json({ error: 'YooKassa is not configured' });
  }

  // Этот endpoint нельзя вызывать напрямую из приложения.
  // Его сможет вызывать только наш Make-сценарий с секретным ключом.
  const authorization = req.headers.authorization || '';
  if (
    !recurringSecret ||
    authorization !== `Bearer ${recurringSecret}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const paymentMethodId = String(body.payment_method_id || '').trim();
    const telegramId = String(body.telegram_id || '').trim().slice(0, 64);
    const username = String(body.username || '')
      .replace(/^@/, '')
      .trim()
      .slice(0, 64);

    if (!paymentMethodId) {
      return res.status(400).json({
        error: 'payment_method_id is required'
      });
    }

    if (!/^\d{5,20}$/.test(telegramId)) {
      return res.status(400).json({
        error: 'Invalid telegram_id'
      });
    }

    const payload = {
      // Пока тестируем автосписание — реально спишется 1 ₽.
      // Перед запуском резидентов заменим на 4900.00.
      amount: {
        value: '4900.00',
        currency: 'RUB'
      },

      capture: true,

      payment_method_id: paymentMethodId,

      description: 'Продление резидентства NK — 1 месяц',

      metadata: {
        product: 'nk_members_monthly_renewal',
        telegram_id: telegramId,
        ...(username ? { telegram_username: username } : {})
      }
    };

    const response = await fetch(
      'https://api.yookassa.ru/v3/payments',
      {
        method: 'POST',
        headers: {
          Authorization:
            `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`,
          'Idempotence-Key': crypto.randomUUID(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data.description ||
          data.code ||
          'YooKassa recurring payment error',
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      payment_id: data.id,
      status: data.status,
      paid: Boolean(data.paid),
      amount: data.amount,
      telegram_id: telegramId
    });

  } catch (error) {
    return res.status(500).json({
      error: 'Не удалось выполнить автосписание',
      details: String(error?.message || error)
    });
  }
};
