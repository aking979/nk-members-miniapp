module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  const paymentId = String(req.query?.payment_id || '');
  if (!shopId || !secretKey) return res.status(500).json({ error: 'YooKassa is not configured' });
  if (!/^[A-Za-z0-9-]{10,80}$/.test(paymentId)) return res.status(400).json({ error: 'Invalid payment_id' });

  try {
    const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.description || data.code || 'YooKassa error' });

    // After YooKassa confirms the first payment, pass the verified payment data
    // to the private Make scenario. Make will update the resident row by telegram_id.
    if (data.status === 'succeeded' && data.paid && process.env.NK_YOOKASSA_MAKE_WEBHOOK_URL) {
      try {
        await fetch(process.env.NK_YOOKASSA_MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'nk_first_payment_succeeded',
            telegram_id: data.metadata?.telegram_id || '',
            telegram_username: data.metadata?.telegram_username || '',
            membership_type: 'NK Monthly',
            membership_amount: 4900,
            actual_payment_amount: data.amount?.value || null,
            currency: data.amount?.currency || 'RUB',
            payment_id: data.id,
            payment_status: data.status,
            paid_at: data.captured_at || data.created_at || null,
            payment_method_saved: Boolean(data.payment_method?.saved),
            payment_method_id: data.payment_method?.saved ? data.payment_method?.id : null,
            payment_method_type: data.payment_method?.type || null
          })
        });
      } catch (makeError) {
        // Do not turn a successful YooKassa payment into an app error if Make is temporarily unavailable.
        console.error('NK Make webhook error:', makeError);
      }
    }

    return res.status(200).json({
      payment_id: data.id,
      status: data.status,
      paid: Boolean(data.paid),
      amount: data.amount,
      payment_method_saved: Boolean(data.payment_method?.saved),
      payment_method_id: data.payment_method?.saved ? data.payment_method?.id : null,
      payment_method_type: data.payment_method?.type || null,
      metadata: data.metadata || {}
    });
  } catch (error) {
    return res.status(500).json({ error: 'Не удалось проверить платеж', details: String(error?.message || error) });
  }
};
