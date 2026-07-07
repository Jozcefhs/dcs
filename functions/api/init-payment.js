// Cloudflare Pages Function: /api/init-payment
// Initializes Paystack checkout from the backend so the secret key stays private.

import { getPayableFees } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';

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

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function schoolFeeInstallmentRules(components) {
  const total = (components || []).reduce((sum, item) => sum + toAmount(item.Amount), 0);
  const installmentItems = (components || []).filter((item) => isYes(item.AllowInstallment));
  const nonInstallmentTotal = (components || []).reduce((sum, item) => {
    return sum + (isYes(item.AllowInstallment) ? 0 : toAmount(item.Amount));
  }, 0);
  const installmentMinimum = (components || []).reduce((sum, item) => {
    if (!isYes(item.AllowInstallment)) return sum;
    const min = toAmount(item.MinAmount);
    return sum + (min > 0 ? min : 0);
  }, 0);
  const minimumInstallmentPortion = installmentItems.length && installmentMinimum <= 0 ? 1 : installmentMinimum;
  const minAmount = Math.min(total, nonInstallmentTotal + minimumInstallmentPortion);
  const allowInstallment = installmentItems.length > 0 && minAmount < total;
  return { total, minAmount, maxAmount: total, allowInstallment };
}

function allocateSchoolFeePayment(components, amount) {
  let remaining = toAmount(amount);
  const allocations = [];
  const ordered = [
    ...(components || []).filter((item) => !isYes(item.AllowInstallment)),
    ...(components || []).filter((item) => isYes(item.AllowInstallment))
  ];
  ordered.forEach((item) => {
    const componentAmount = toAmount(item.Amount);
    if (componentAmount <= 0) return;
    let payAmount = 0;
    if (!isYes(item.AllowInstallment)) {
      payAmount = componentAmount;
    } else if (remaining > 0) {
      payAmount = Math.min(componentAmount, remaining);
    }
    remaining -= payAmount;
    if (payAmount > 0) {
      allocations.push({
        FeeCode: item.FeeCode,
        FeeName: item.FeeName,
        FeeCategory: item.FeeCategory || 'School Fee',
        Amount: payAmount,
        OriginalAmount: componentAmount,
        Currency: item.Currency || 'NGN',
        AcademicSession: item.AcademicSession || '',
        Term: item.Term || '',
        AllowInstallment: item.AllowInstallment || '',
        MinAmount: item.MinAmount || '',
        MaxAmount: item.MaxAmount || ''
      });
    }
  });
  return allocations;
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

    if (!env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Online payment is not configured yet.' }, { status: 500 });
    }

    let feeData = null;
    try {
      requireFirestoreEnv(env);
      feeData = await getPayableFees(env, { Email: email, VerificationCode: code });
    } catch (firestoreErr) {
      if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
        return Response.json({ ok: false, message: firestoreErr.message || String(firestoreErr) }, { status: firestoreErr.status || 500 });
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
      feeData = await feeRes.json();
    }
    if (!feeData.ok) {
      return Response.json(feeData, { status: 400 });
    }

    let fee = (feeData.fees || []).find((item) => String(item.FeeCode || '').trim() === feeCode);
    const schoolFeeComponents = (feeData.schoolFeeBreakdown || []).filter(isSchoolFee);
    if (feeCode === SCHOOL_FEES_TOTAL_CODE && schoolFeeComponents.length) {
      const rules = schoolFeeInstallmentRules(schoolFeeComponents);
      fee = {
        FeeCode: SCHOOL_FEES_TOTAL_CODE,
        FeeName: 'School Fees Total',
        FeeCategory: 'School Fee',
        Amount: rules.total,
        Currency: schoolFeeComponents[0].Currency || 'NGN',
        AllowInstallment: rules.allowInstallment ? 'YES' : 'NO',
        MinAmount: rules.allowInstallment ? rules.minAmount : '',
        MaxAmount: rules.total,
        PaymentType: 'SchoolFeesTotal',
        AcademicSession: schoolFeeComponents[0].AcademicSession || '',
        Term: schoolFeeComponents[0].Term || '',
        Components: schoolFeeComponents.map((item) => ({
          FeeCode: item.FeeCode,
          FeeName: item.FeeName,
          FeeCategory: item.FeeCategory || 'School Fee',
          Amount: toAmount(item.Amount),
          OriginalAmount: toAmount(item.OriginalAmount || item.Amount),
          PaidAmount: toAmount(item.PaidAmount),
          BalanceAmount: toAmount(item.BalanceAmount || item.Amount),
          Currency: item.Currency || schoolFeeComponents[0].Currency || 'NGN',
          AcademicSession: item.AcademicSession || '',
          Term: item.Term || '',
          AllowInstallment: item.AllowInstallment || '',
          MinAmount: item.MinAmount || '',
          MaxAmount: item.MaxAmount || ''
        }))
      };
    }
    if (!fee) {
      return Response.json({ ok: false, message: 'That fee is not currently payable.' }, { status: 400 });
    }

    const isWallet = isWalletFee(fee);
    const isSchoolFeesTotal = feeCode === SCHOOL_FEES_TOTAL_CODE;
    const configuredAmount = toAmount(fee.Amount);
    const schoolFeeRules = isSchoolFeesTotal ? schoolFeeInstallmentRules(fee.Components || []) : null;
    const canPartPaySchoolFees = Boolean(schoolFeeRules && schoolFeeRules.allowInstallment);
    const amount = (isWallet || canPartPaySchoolFees) ? requestedAmount : configuredAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ ok: false, message: (isWallet || canPartPaySchoolFees) ? 'Enter an amount greater than zero.' : 'This fee amount has not been configured.' }, { status: 400 });
    }
    const minAmount = toAmount(fee.MinAmount);
    const maxAmount = toAmount(fee.MaxAmount);
    if (isWallet && minAmount > 0 && amount < minAmount) {
      return Response.json({ ok: false, message: `Minimum wallet top-up is ${minAmount}.` }, { status: 400 });
    }
    if (isWallet && maxAmount > 0 && amount > maxAmount) {
      return Response.json({ ok: false, message: `Maximum wallet top-up is ${maxAmount}.` }, { status: 400 });
    }
    if (isSchoolFeesTotal && !canPartPaySchoolFees && Math.abs(amount - configuredAmount) > 0.01) {
      return Response.json({ ok: false, message: 'Part payment is not enabled for this school fee.' }, { status: 400 });
    }
    if (canPartPaySchoolFees && schoolFeeRules.minAmount > 0 && amount < schoolFeeRules.minAmount) {
      return Response.json({ ok: false, message: `Minimum school fee payment is ${schoolFeeRules.minAmount}.` }, { status: 400 });
    }
    if (canPartPaySchoolFees && schoolFeeRules.maxAmount > 0 && amount > schoolFeeRules.maxAmount) {
      return Response.json({ ok: false, message: `Maximum school fee payment is ${schoolFeeRules.maxAmount}.` }, { status: 400 });
    }
    const schoolFeeItems = isSchoolFeesTotal
      ? allocateSchoolFeePayment(fee.Components || [], amount)
      : undefined;

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
          feeItems: schoolFeeItems,
          fullSchoolFeeAmount: isSchoolFeesTotal ? configuredAmount : undefined,
          partPayment: isSchoolFeesTotal && amount < configuredAmount,
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
