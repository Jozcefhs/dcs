const loginForm = document.getElementById('parentLoginForm');
const statusEl = document.getElementById('parentStatus');
const dashboardContent = document.getElementById('dashboardContent');
const childrenList = document.getElementById('childrenList');
const walletSummary = document.getElementById('walletSummary');
const walletLedger = document.getElementById('walletLedger');
const dueNotifications = document.getElementById('dueNotifications');
const payableItems = document.getElementById('payableItems');
const paymentRecords = document.getElementById('paymentRecords');
const clinicRecords = document.getElementById('clinicRecords');
const restrictionForm = document.getElementById('restrictionForm');
const walletStatus = document.getElementById('walletStatus');
const txnLimit = document.getElementById('txnLimit');
const dailyLimit = document.getElementById('dailyLimit');
const pinThreshold = document.getElementById('pinThreshold');

let dashboard = null;
let selectedAccountRef = '';

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function money(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN'
  }).format(Number.isFinite(amount) ? amount : 0);
}

function authPayload() {
  return {
    email: document.getElementById('parentEmail').value.trim().toLowerCase(),
    code: document.getElementById('verificationCode').value.trim().toUpperCase()
  };
}

function selectedChild() {
  return (dashboard?.children || []).find((child) => child.AccountRef === selectedAccountRef) || null;
}

function renderChildren() {
  childrenList.innerHTML = '';
  const children = dashboard?.children || [];
  children.forEach((child) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'child-card' + (child.AccountRef === selectedAccountRef ? ' selected' : '');
    button.innerHTML = `
      <strong>${child.DisplayName || 'Student'}</strong>
      <span>${child.AccountRef || ''}</span>
      <span>${child.ClassName || ''} ${child.StudentType ? '| ' + child.StudentType : ''}</span>
      <span>Status: ${child.Status || 'Active'}</span>
    `;
    button.addEventListener('click', () => {
      selectedAccountRef = child.AccountRef;
      renderDashboard();
    });
    childrenList.appendChild(button);
  });
}

function renderWallet(child) {
  walletSummary.innerHTML = `
    <div><strong>${money(child.WalletBalance)}</strong><span>Wallet Balance</span></div>
    <div><strong>${child.WalletCardStatus || 'Active'}</strong><span>Card Status</span></div>
    <div><strong>${money(child.WalletTxnLimit)}</strong><span>Per Purchase Limit</span></div>
    <div><strong>${money(child.WalletDailyLimit)}</strong><span>Daily Limit</span></div>
  `;

  walletStatus.value = child.WalletCardStatus || 'Active';
  txnLimit.value = child.WalletTxnLimit || '';
  dailyLimit.value = child.WalletDailyLimit || '';
  pinThreshold.value = child.WalletPinThreshold || '';

  const entries = dashboard.walletActivity?.[child.AccountRef] || [];
  walletLedger.innerHTML = entries.length ? '' : '<p class="muted">No wallet activity found.</p>';
  entries.slice(0, 20).forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${entry.Description || entry.EntryType || 'Wallet activity'}</strong>
      <span>${entry.Date || ''} | ${entry.Debit ? '-' + money(entry.Debit) : '+' + money(entry.Credit)}</span>
      <small>${entry.RecordedBy || entry.Source || ''}</small>
    `;
    walletLedger.appendChild(item);
  });
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function renderDueNotifications(child) {
  const records = dashboard.dueNotifications?.[child.AccountRef] || [];
  dueNotifications.innerHTML = records.length ? '' : '<p class="muted">No payment due date notifications at the moment.</p>';
  records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${record.FeeName || record.FeeCode || 'Payment due'}</strong>
      <span>${record.DueStatus || 'Due date set'} | ${record.DueDate || ''} | ${money(record.Amount)}</span>
      <small>${[record.AcademicSession, record.Term].filter(Boolean).join(' | ')}</small>
    `;
    dueNotifications.appendChild(item);
  });
}

function paymentAmountFor(fee) {
  const amount = Number(String(fee.Amount || '0').replace(/,/g, ''));
  if (!isYes(fee.AllowInstallment)) return amount;
  const min = Number(String(fee.MinAmount || '0').replace(/,/g, ''));
  const defaultAmount = Number.isFinite(min) && min > 0 ? min : amount;
  const entered = window.prompt(`Enter amount to pay for ${fee.FeeName || fee.FeeCode}`, String(defaultAmount));
  if (entered === null) return null;
  const value = Number(String(entered || '0').replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) {
    setStatus('Enter a valid amount.', 'bad');
    return null;
  }
  if (Number.isFinite(min) && min > 0 && value < min) {
    setStatus(`Minimum amount is ${money(min)}.`, 'bad');
    return null;
  }
  if (Number.isFinite(amount) && amount > 0 && value > amount) {
    setStatus(`Maximum amount is ${money(amount)}.`, 'bad');
    return null;
  }
  return value;
}

async function payItem(child, fee) {
  const amount = paymentAmountFor(fee);
  if (amount === null) return;
  try {
    setStatus('Starting secure checkout...', '');
    const response = await fetch('/api/init-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...authPayload(),
        accountRef: child.AccountRef,
        feeCode: fee.FeeCode,
        components: fee.Components || undefined,
        amount: isYes(fee.AllowInstallment) ? amount : undefined
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not initialize payment.');
    }
    window.location.href = data.authorizationUrl;
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

function renderPayableItems(child) {
  const records = dashboard.payableItems?.[child.AccountRef] || [];
  payableItems.innerHTML = records.length ? '' : '<p class="muted">There are no online payment items due at the moment.</p>';
  records.forEach((fee) => {
    const item = document.createElement('div');
    item.className = 'activity-item payment-action';
    const period = [fee.AcademicSession, fee.Term].filter(Boolean).join(' | ');
    item.innerHTML = `
      <strong>${fee.FeeName || fee.FeeCode}</strong>
      <span>${money(fee.Amount)}${period ? ' | ' + period : ''}${fee.DueDate ? ' | Due: ' + fee.DueDate : ''}</span>
      <small>${fee.FeeCategory || ''}${isYes(fee.AllowInstallment) ? ' | Part payment allowed' : ''}</small>
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Pay Now';
    button.addEventListener('click', () => payItem(child, fee));
    item.appendChild(button);
    payableItems.appendChild(item);
  });
}

function renderClinic(child) {
  const records = dashboard.clinicVisits?.[child.AccountRef] || [];
  clinicRecords.innerHTML = records.length ? '' : '<p class="muted">No clinic visits found.</p>';
  records.slice(0, 20).forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${record.Complaint || 'Clinic visit'}</strong>
      <span>${record.Date || ''} | ${record.Disposition || ''}</span>
      <small>${record.Treatment || ''}</small>
    `;
    clinicRecords.appendChild(item);
  });
}

function renderPayments(child) {
  const records = dashboard.paymentRecords?.[child.AccountRef] || [];
  paymentRecords.innerHTML = records.length ? '' : '<p class="muted">No payment records found.</p>';
  records.slice(0, 40).forEach((record) => {
    const isCredit = Number(record.Credit || record.Amount || 0) > 0 && Number(record.Debit || 0) === 0;
    const amount = record.Amount || record.Credit || record.Debit || 0;
    const period = [record.AcademicSession, record.Term].filter(Boolean).join(' | ');
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${record.Description || record.FeeName || record.FeeCode || record.RecordType || 'Payment record'}</strong>
      <span>${record.Date || ''}${period ? ' | ' + period : ''} | ${isCredit ? '+' : ''}${money(amount)}</span>
      <small>${record.RecordType || ''}${record.Status ? ' | Status: ' + record.Status : ''}${record.Reference ? ' | Ref: ' + record.Reference : ''}</small>
    `;
    paymentRecords.appendChild(item);
  });
}

function renderDashboard() {
  const children = dashboard?.children || [];
  if (!selectedAccountRef && children.length) {
    selectedAccountRef = children[0].AccountRef;
  }
  renderChildren();
  const child = selectedChild();
  if (!child) return;
  renderDueNotifications(child);
  renderPayableItems(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
}

async function loadDashboard() {
  const payload = authPayload();
  if (!payload.email || !payload.code) {
    setStatus('Email and verification code are required.', 'bad');
    return;
  }
  setStatus('Loading dashboard...', '');
  const response = await fetch('/api/parent-dashboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getDashboard', ...payload })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'Could not load parent dashboard.');
  }
  dashboard = data;
  selectedAccountRef = data.children?.[0]?.AccountRef || '';
  dashboardContent.hidden = false;
  renderDashboard();
  setStatus('Dashboard loaded.', 'ok');
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loadDashboard();
  } catch (error) {
    dashboardContent.hidden = true;
    setStatus(error.message, 'bad');
  }
});

restrictionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const child = selectedChild();
  if (!child) {
    setStatus('Select a child first.', 'bad');
    return;
  }
  try {
    setStatus('Saving wallet restrictions...', '');
    const response = await fetch('/api/parent-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateWalletRestrictions',
        ...authPayload(),
        accountRef: child.AccountRef,
        walletCardStatus: walletStatus.value,
        walletTxnLimit: txnLimit.value,
        walletDailyLimit: dailyLimit.value,
        walletPinThreshold: pinThreshold.value
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Could not save wallet restrictions.');
    }
    await loadDashboard();
    setStatus('Wallet restrictions saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'bad');
  }
});
