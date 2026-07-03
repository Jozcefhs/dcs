// Cloudflare Pages Function: /api/init-payment
// Initializes Paystack checkout from the backend so the secret key stays private.

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';
const SCHOOL_FEES_TOTAL_CODE = 'SCHOOL_FEES_TOTAL';

function cleanReference(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.=-]/g, '-');
}

function toAmount(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : 0;
}

function isWalletFee(fee) {
  return fee && (String(fee.FeeCode || '').trim() === 'WALLET_TOPUP' || String(fee.FeeCategory || '').trim().toLowerCase() === 'wallet');
}

function isSchoolFee(fee) {
  return fee && !isWalletFee(fee) && String(fee.FeeCategory || 'School Fee').trim().toLowerCase() === 'school fee';
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();
    const feeCode = String(body.feeCode || '').trim();
    const requestedAmount = Number(String(body.amount || '0').replace(/,/g, ''));

    if (!email || !code || !feeCode) {
      return Response.json({ ok: false, message: 'Email, verification code, and fee are required.' }, { status: 400 });
    }

    if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET || !env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Online payment is not configured yet.' }, { status: 500 });
    }

    const feeRes = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getPayableFees',
        Email: email,
        VerificationCode: code
      })
    });
    const feeData = await feeRes.json();
    if (!feeData.ok) {
      return Response.json(feeData, { status: 400 });
    }

    let fee = (feeData.fees || []).find((item) => String(item.FeeCode || '').trim() === feeCode);
    const schoolFeeComponents = (feeData.schoolFeeBreakdown || []).filter(isSchoolFee);
    if (feeCode === SCHOOL_FEES_TOTAL_CODE && schoolFeeComponents.length) {
      const total = schoolFeeComponents.reduce((sum, item) => sum + toAmount(item.Amount), 0);
      fee = {
        FeeCode: SCHOOL_FEES_TOTAL_CODE,
        FeeName: 'School Fees Total',
        FeeCategory: 'School Fee',
        Amount: total,
        Currency: schoolFeeComponents[0].Currency || 'NGN',
        PaymentType: 'SchoolFeesTotal',
        Components: schoolFeeComponents.map((item) => ({
          FeeCode: item.FeeCode,
          FeeName: item.FeeName,
          FeeCategory: item.FeeCategory || 'School Fee',
          Amount: toAmount(item.Amount),
          Currency: item.Currency || schoolFeeComponents[0].Currency || 'NGN',
          AcademicSession: item.AcademicSession || '',
          Term: item.Term || ''
        }))
      };
    }
    if (!fee) {
      return Response.json({ ok: false, message: 'That fee is not currently payable.' }, { status: 400 });
    }

    const isWallet = isWalletFee(fee);
    const isSchoolFeesTotal = feeCode === SCHOOL_FEES_TOTAL_CODE;
    const configuredAmount = toAmount(fee.Amount);
    const amount = isWallet ? requestedAmount : configuredAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ ok: false, message: isWallet ? 'Enter a wallet amount greater than zero.' : 'This fee amount has not been configured.' }, { status: 400 });
    }
    const minAmount = toAmount(fee.MinAmount);
    const maxAmount = toAmount(fee.MaxAmount);
    if (isWallet && minAmount > 0 && amount < minAmount) {
      return Response.json({ ok: false, message: `Minimum wallet top-up is ${minAmount}.` }, { status: 400 });
    }
    if (isWallet && maxAmount > 0 && amount > maxAmount) {
      return Response.json({ ok: false, message: `Maximum wallet top-up is ${maxAmount}.` }, { status: 400 });
    }

    const account = feeData.account || {};
    const origin = new URL(request.url).origin;
    const reference = cleanReference(`DCA-${feeCode}-${account.ApplicationReference || account.AccountRef}-${Date.now()}`);
    const callbackUrl = `${origin}/payment-success.html?reference=${encodeURIComponent(reference)}`;

    const paystackRes = await fetch(PAYSTACK_INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency: String(fee.Currency || 'NGN'),
        reference,
        callback_url: callbackUrl,
        metadata: {
          feeCode,
          feeName: fee.FeeName,
          feeCategory: fee.FeeCategory || '',
          paymentType: isWallet ? 'Wallet' : (isSchoolFeesTotal ? 'SchoolFeesTotal' : 'Fee'),
          feeItems: isSchoolFeesTotal ? fee.Components : undefined,
          accountRef: account.AccountRef,
          applicationReference: account.ApplicationReference,
          admissionNo: account.AdmissionNo,
          displayName: account.DisplayName,
          className: account.ClassName,
          studentType: account.StudentType,
          academicSession: account.AcademicSession,
          term: account.Term,
          verificationEmail: email
        }
      })
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return Response.json({ ok: false, message: paystackData.message || 'Could not start Paystack payment.' }, { status: 400 });
    }

    return Response.json({
      ok: true,
      message: 'Payment initialized.',
      authorizationUrl: paystackData.data.authorization_url,
      reference: paystackData.data.reference
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
