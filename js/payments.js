const lookupForm = document.getElementById('paymentLookupForm');
const statusEl = document.getElementById('paymentStatus');
const lookupBtn = document.getElementById('lookupBtn');
const feePanel = document.getElementById('feePanel');
const feeList = document.getElementById('feeList');
const accountSummary = document.getElementById('accountSummary');
const payBtn = document.getElementById('payBtn');

let currentEmail = '';
let currentCode = '';
let currentFees = [];

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

function renderFees(account, fees) {
  currentFees = fees || [];
  feeList.innerHTML = '';
  feePanel.hidden = false;
  accountSummary.textContent = `${account.DisplayName || 'Applicant'} | ${account.ApplicationReference || account.AccountRef || ''} | ${account.ClassName || ''}`;

  if (!currentFees.length) {
    feeList.innerHTML = '<p class="muted">There are no online fees due at the moment.</p>';
    payBtn.disabled = true;
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
    const textWrap = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = fee.FeeName || fee.FeeCode;
    const amount = document.createElement('small');
    amount.textContent = formatMoney(fee.Amount, fee.Currency);
    textWrap.append(name, amount);
    row.append(input, textWrap);
    feeList.appendChild(row);
  });
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
    renderFees(data.account || {}, data.fees || []);
    setStatus('Select a fee and continue to Paystack checkout.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  } finally {
    lookupBtn.disabled = false;
  }
});

payBtn.addEventListener('click', async () => {
  const selected = document.querySelector('input[name="feeCode"]:checked');
  if (!selected) {
    setStatus('Select a fee to pay.', 'bad');
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
        feeCode: selected.value
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
