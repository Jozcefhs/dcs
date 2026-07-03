// Cloudflare Pages Function: /api/verify-payment
// Verifies Paystack payment and records it in Apps Script.

function extractMetadata(data) {
  const metadata = data && data.metadata;
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (_err) {
      return {};
    }
  }
  return metadata;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const reference = String(body.reference || '').trim();

    if (!reference) {
      return Response.json({ ok: false, message: 'Payment reference is required.' }, { status: 400 });
    }

    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET || !env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Online payment verification is not configured yet.' }, { status: 500 });
    }

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      return Response.json({ ok: false, message: paystackData.message || 'Payment has not been confirmed.' }, { status: 400 });
    }

    const tx = paystackData.data;
    const meta = extractMetadata(tx);
    const amount = Number(tx.amount || 0) / 100;
    const recordRes = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'recordOnlinePayment',
        AccountRef: meta.accountRef || meta.applicationReference,
        ApplicationReference: meta.applicationReference || '',
        AdmissionNo: meta.admissionNo || '',
        DisplayName: meta.displayName || '',
        ClassName: meta.className || '',
        StudentType: meta.studentType || '',
        AcademicSession: meta.academicSession || '',
        Term: meta.term || '',
        FeeCode: meta.feeCode || 'ONLINE_PAYMENT',
        FeeName: meta.feeName || 'Online Payment',
        FeeCategory: meta.feeCategory || '',
        PaymentType: meta.paymentType || '',
        FeeItems: meta.feeItems ? JSON.stringify(meta.feeItems) : '',
        Amount: amount,
        Currency: tx.currency || 'NGN',
        Gateway: 'Paystack',
        Method: 'Online',
        Reference: tx.reference,
        GatewayReference: tx.reference,
        Channel: tx.channel || '',
        PaidAt: tx.paid_at || tx.paidAt || '',
        ReceiptNo: tx.receipt_number || '',
        Metadata: JSON.stringify({
          paystackId: tx.id,
          gatewayResponse: tx.gateway_response,
          fees: tx.fees,
          requestedAmount: tx.requested_amount,
          metadata: meta
        })
      })
    });
    const recordData = await recordRes.json();
    if (!recordData.ok) {
      return Response.json(recordData, { status: 400 });
    }

    return Response.json({
      ok: true,
      message: 'Payment verified and recorded.',
      payment: recordData.payment || {},
      reference: tx.reference,
      amount,
      currency: tx.currency || 'NGN',
      feeName: meta.feeName || 'Online Payment'
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
