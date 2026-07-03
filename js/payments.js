const lookupForm = document.getElementById('paymentLookupForm');
const statusEl = document.getElementById('paymentStatus');
const lookupBtn = document.getElementById('lookupBtn');
const feePanel = document.getElementById('feePanel');
const feeList = document.getElementById('feeList');
const accountSummary = document.getElementById('accountSummary');
const payBtn = document.getElementById('payBtn');
const breakdownEl = document.getElementById('schoolFeeBreakdown');
const walletAmountBox = document.getElementById('walletAmountBox');
const walletAmountInput = document.getElementById('walletAmount');

let currentEmail = '';
let currentCode = '';
let currentFees = [];
let currentBreakdown = [];

const SCHOOL_FEES_TOTAL_CODE = 'SCHOOL_FEES_TOTAL';

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function formatMoney(amount, currency) {
  const number = Number(String(amount || '0').replace(/,/g, ''));
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN'
  }).format(Number.isFinite(number) ? number : 0);
}

function isWalletFee(fee) {
  return fee && (fee.FeeCode === 'WALLET_TOPUP' || String(fee.FeeCategory || '').toLowerCase() === 'wallet');
}

function isSchoolFee(fee) {
  return fee && !isWalletFee(fee) && String(fee.FeeCategory || 'School Fee').trim().toLowerCase() === 'school fee';
}

function selectedFee() {
  const selected = document.querySelector('input[name="feeCode"]:checked');
  if (!selected) return null;
  return currentFees.find((fee) => String(fee.FeeCode) === selected.value) || null;
}

function updateWalletAmountVisibility() {
  const fee = selectedFee();
  const isWallet = isWalletFee(fee);
  walletAmountBox.hidden = !isWallet;
  if (isWallet && !walletAmountInput.value) {
    walletAmountInput.value = fee.MinAmount || '';
  }
}

function renderBreakdown(breakdown) {
  currentBreakdown = breakdown || [];
  breakdownEl.innerHTML = '';
  if (!currentBreakdown.length) {
    breakdownEl.hidden = true;
    return;
  }
  breakdownEl.hidden = false;
  const title = document.createElement('h2');
  title.textContent = 'School Fee Breakdown';
  breakdownEl.appendChild(title);
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'This shows how the school fee total is made up. Parents pay the total amount, not the individual components.';
  breakdownEl.appendChild(note);
  let total = 0;
  currentBreakdown.forEach((fee) => {
    const amount = Number(String(fee.Amount || '0').replace(/,/g, ''));
    total += Number.isFinite(amount) ? amount : 0;
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    const name = document.createElement('span');
    name.textContent = fee.FeeName || fee.FeeCode;
    const value = document.createElement('strong');
    value.textContent = formatMoney(fee.Amount, fee.Currency);
    row.append(name, value);
    breakdownEl.appendChild(row);
  });
  const totalRow = document.createElement('div');
  totalRow.className = 'breakdown-row total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Total';
  const totalValue = document.createElement('strong');
  totalValue.textContent = formatMoney(total, currentBreakdown[0].Currency || 'NGN');
  totalRow.append(totalLabel, totalValue);
  breakdownEl.appendChild(totalRow);
}

function schoolFeeTotalItem(breakdown) {
  const items = (breakdown || []).filter(isSchoolFee);
  if (!items.length) return null;
  const total = items.reduce((sum, fee) => {
    const amount = Number(String(fee.Amount || '0').replace(/,/g, ''));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  if (total <= 0) return null;
  return {
    FeeCode: SCHOOL_FEES_TOTAL_CODE,
    FeeName: 'School Fees Total',
    FeeCategory: 'School Fee',
    Amount: total,
    Currency: items[0].Currency || 'NGN',
    PaymentType: 'SchoolFeesTotal',
    Components: items.map((fee) => ({
      FeeCode: fee.FeeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory || 'School Fee',
      Amount: fee.Amount,
      Currency: fee.Currency || items[0].Currency || 'NGN',
      AcademicSession: fee.AcademicSession || '',
      Term: fee.Term || ''
    }))
  };
}

function buildPayableItems(fees, breakdown) {
  const items = [];
  const schoolTotal = schoolFeeTotalItem(breakdown);
  if (schoolTotal) {
    items.push(schoolTotal);
  }
  (fees || []).forEach((fee) => {
    if (isSchoolFee(fee)) return;
    items.push(fee);
  });
  return items;
}

function renderFees(account, fees, breakdown) {
  currentFees = buildPayableItems(fees || [], breakdown || []);
  feeList.innerHTML = '';
  feePanel.hidden = false;
  accountSummary.textContent = `${account.DisplayName || 'Student'} | ${account.ApplicationReference || account.AccountRef || ''} | ${account.ClassName || ''} | ${account.StudentType || ''}`;
  renderBreakdown(breakdown || []);

  if (!currentFees.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'There are no online payment items due at the moment.';
    feeList.appendChild(empty);
    payBtn.disabled = true;
    updateWalletAmountVisibility();
    return;
  }

  payBtn.disabled = false;
  currentFees.forEach((fee, index) => {
    const id = `fee-${index}`;
    const row = document.createElement('label');
    row.className = 'fee-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'feeCode';
    input.value = fee.FeeCode;
    input.id = id;
    input.checked = index === 0;
    input.addEventListener('change', updateWalletAmountVisibility);
    const textWrap = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = `${fee.FeeName || fee.FeeCode}${fee.FeeCategory ? ` (${fee.FeeCategory})` : ''}`;
    const amount = document.createElement('small');
    amount.textContent = isWalletFee(fee) ? 'Enter amount' : formatMoney(fee.Amount, fee.Currency);
    textWrap.append(name, amount);
    row.append(input, textWrap);
    feeList.appendChild(row);
  });
  updateWalletAmountVisibility();
}

lookupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  currentEmail = document.getElementById('email').value.trim().toLowerCase();
  currentCode = document.getElementById('code').value.trim().toUpperCase();
  feePanel.hidden = true;
  lookupBtn.disabled = true;
  setStatus('Checking payable fees...', '');

  try {
    const response = await fetch('/api/payment-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentEmail, code: currentCode })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not load payable fees.');
    }
    renderFees(data.account || {}, data.fees || [], data.schoolFeeBreakdown || []);
    setStatus('Review the payable amount and continue to Paystack checkout.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    lookupBtn.disabled = false;
  }
});

payBtn.addEventListener('click', async () => {
  const fee = selectedFee();
  if (!fee) {
    setStatus('Select a payment item to pay.', 'bad');
    return;
  }
  const walletAmount = isWalletFee(fee) ? Number(walletAmountInput.value || 0) : 0;
  if (isWalletFee(fee) && (!Number.isFinite(walletAmount) || walletAmount <= 0)) {
    setStatus('Enter the wallet amount to pay.', 'bad');
    return;
  }

  payBtn.disabled = true;
  setStatus('Starting secure checkout...', '');
  try {
    const response = await fetch('/api/init-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentEmail,
        code: currentCode,
        feeCode: fee.FeeCode,
        components: fee.Components || undefined,
        amount: isWalletFee(fee) ? walletAmount : undefined
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not initialize payment.');
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setStatus(error.message, 'bad');
    payBtn.disabled = false;
  }
});
