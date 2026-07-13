const loginForm = document.getElementById('parentLoginForm');
const statusEl = document.getElementById('parentStatus');
const dashboardContent = document.getElementById('dashboardContent');
const childrenList = document.getElementById('childrenList');
const walletSummary = document.getElementById('walletSummary');
const walletLedger = document.getElementById('walletLedger');
const dueNotifications = document.getElementById('dueNotifications');
const payableItems = document.getElementById('payableItems');
const paymentRecords = document.getElementById('paymentRecords');
const entranceResults = document.getElementById('entranceResults');
const clinicRecords = document.getElementById('clinicRecords');
const restrictionForm = document.getElementById('restrictionForm');
const walletStatus = document.getElementById('walletStatus');
const txnLimit = document.getElementById('txnLimit');
const dailyLimit = document.getElementById('dailyLimit');
const pinThreshold = document.getElementById('pinThreshold');
const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');

let dashboard = null;
let selectedAccountRef = '';
const loadedPayables = new Set();

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
      <span>${[child.ClassName, child.ClassArm, child.StudentType].filter(Boolean).join(' | ')}</span>
      <span>Status: ${child.Status || 'Active'}</span>
    `;
    button.addEventListener('click', () => {
      selectedAccountRef = child.AccountRef;
      renderDashboard();
      loadPayablesForSelected();
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

function isWalletFee(fee) {
  return String(fee.FeeCode || '').trim() === 'WALLET_TOPUP' || String(fee.FeeCategory || '').trim().toLowerCase() === 'wallet';
}

function renderComponents(parent, components) {
  const groups = {};
  (components || []).forEach((component) => {
    const category = component.FeeCategory || component.Department || 'School Fee';
    groups[category] = groups[category] || [];
    groups[category].push(component);
  });
  Object.entries(groups).forEach(([category, rows]) => {
    const heading = document.createElement('small');
    heading.className = 'component-heading';
    heading.textContent = category;
    parent.appendChild(heading);
    const list = document.createElement('ul');
    list.className = 'component-list';
    rows.forEach((component) => {
      const line = document.createElement('li');
      const originalAmount = component.OriginalAmount || component.Amount;
      line.textContent = `${component.FeeName || component.FeeCode}: ${money(originalAmount)}`;
      list.appendChild(line);
    });
    parent.appendChild(list);
  });
}

function renderDueNotifications(child) {
  const records = dashboard.dueNotifications?.[child.AccountRef] || [];
  dueNotifications.innerHTML = records.length ? '' : '<p class="muted">No payment due date notifications at the moment.</p>';
  records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    const displayAmount = record.OriginalAmount || record.Amount;
    item.innerHTML = `
      <strong>${record.FeeName || record.FeeCode || 'Payment due'}</strong>
      <span>${record.DueStatus || 'Due date set'} | ${record.DueDate || ''} | ${money(displayAmount)}</span>
      <small>${[record.AcademicSession, record.Term].filter(Boolean).join(' | ')}</small>
    `;
    if (record.Components?.length) {
      renderComponents(item, record.Components);
    }
    dueNotifications.appendChild(item);
  });
}

async function loadPayablesForSelected() {
  const child = selectedChild();
  if (!child || loadedPayables.has(child.AccountRef)) return;
  loadedPayables.add(child.AccountRef);
  dashboard.payableItems = dashboard.payableItems || {};
  dashboard.payableErrors = dashboard.payableErrors || {};
  dashboard.dueNotifications = dashboard.dueNotifications || {};
  dashboard.walletActivity = dashboard.walletActivity || {};
  dashboard.paymentRecords = dashboard.paymentRecords || {};
  dashboard.clinicVisits = dashboard.clinicVisits || {};
  dashboard.entranceResults = dashboard.entranceResults || {};
  dashboard.payableItems[child.AccountRef] = [];
  dashboard.payableErrors[child.AccountRef] = '';
  renderPayableItems(child);
  renderDueNotifications(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderEntranceResults(child);
  try {
    const baseBody = {
      ...authPayload(),
      accountRef: child.AccountRef
    };
    const payableRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getChildPayable',
        ...baseBody
      })
    });
    const activityRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'getChildActivity',
        ...baseBody
      })
    });
    const [payableResponse, activityResponse] = await Promise.all([payableRequest, activityRequest]);
    const payableData = await payableResponse.json();
    const activityData = await activityResponse.json();
    if (!payableResponse.ok || !payableData.ok) {
      dashboard.payableErrors[child.AccountRef] = payableData.message || 'Could not load payable items.';
    } else {
      dashboard.payableItems[child.AccountRef] = payableData.payableItems || [];
      dashboard.dueNotifications[child.AccountRef] = payableData.dueNotifications || [];
    }
    if (activityResponse.ok && activityData.ok) {
      dashboard.walletActivity[child.AccountRef] = activityData.walletActivity || [];
      dashboard.paymentRecords[child.AccountRef] = activityData.paymentRecords || [];
      dashboard.clinicVisits[child.AccountRef] = activityData.clinicVisits || [];
      dashboard.entranceResults[child.AccountRef] = activityData.entranceResults || [];
      child.WalletBalance = activityData.walletBalance ?? child.WalletBalance;
    } else {
      dashboard.payableErrors[child.AccountRef] = dashboard.payableErrors[child.AccountRef] || activityData.message || 'Could not load child activity.';
    }
  } catch (error) {
    dashboard.payableItems[child.AccountRef] = [];
    dashboard.dueNotifications[child.AccountRef] = [];
    dashboard.payableErrors[child.AccountRef] = error.message;
  }
  renderPayableItems(child);
  renderDueNotifications(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderEntranceResults(child);
}

function amountInputId(fee) {
  return `amount-${String(fee.FeeCode || 'fee').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function paymentAmountFor(fee) {
  const input = document.getElementById(amountInputId(fee));
  const amount = Number(String(fee.Amount || '0').replace(/,/g, ''));
  if (!isWalletFee(fee) && !isYes(fee.AllowInstallment)) return amount;
  const min = Number(String(fee.MinAmount || '0').replace(/,/g, ''));
  const entered = input ? input.value : '';
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
        amount: (isWalletFee(fee) || isYes(fee.AllowInstallment)) ? amount : undefined
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
  const payableError = dashboard.payableErrors?.[child.AccountRef] || '';
  const loading = !loadedPayables.has(child.AccountRef);
  payableItems.innerHTML = records.length ? '' : `<p class="${payableError ? 'status bad' : 'muted'}">${payableError || (loading ? 'Loading payable items...' : 'There are no online payment items due at the moment.')}</p>`;
  records.forEach((fee) => {
    const item = document.createElement('div');
    item.className = 'activity-item payment-action';
    const period = [fee.AcademicSession, fee.Term].filter(Boolean).join(' | ');
    const allowAmountEntry = isWalletFee(fee) || isYes(fee.AllowInstallment);
    const defaultAmount = Number(fee.MinAmount || 0) > 0 ? fee.MinAmount : (isWalletFee(fee) ? '' : fee.Amount);
    const displayAmount = fee.OriginalAmount || fee.Amount;
    const creditApplied = Number(String(fee.CreditApplied || '0').replace(/,/g, ''));
    const balanceNote = Number.isFinite(creditApplied) && creditApplied > 0
      ? `<small>Amount to pay is ${money(fee.Amount)} because acceptance fee credit of ${money(creditApplied)} has already been deducted.</small>`
      : '';
    item.innerHTML = `
      <strong>${fee.FeeName || fee.FeeCode}</strong>
      <span>${money(displayAmount)}${period ? ' | ' + period : ''}${fee.DueDate ? ' | Due: ' + fee.DueDate : ''}</span>
      <small>${fee.FeeCategory || ''}${isYes(fee.AllowInstallment) ? ' | Part payment allowed' : ''}</small>
      ${balanceNote}
    `;
    if (fee.Components?.length) {
      renderComponents(item, fee.Components);
    }
    if (allowAmountEntry) {
      const label = document.createElement('label');
      label.setAttribute('for', amountInputId(fee));
      label.textContent = isWalletFee(fee) ? 'Wallet top-up amount' : 'Amount to pay now';
      const input = document.createElement('input');
      input.id = amountInputId(fee);
      input.type = 'number';
      input.min = fee.MinAmount || '1';
      if (!isWalletFee(fee) && fee.MaxAmount) input.max = fee.MaxAmount;
      input.step = '0.01';
      input.value = defaultAmount;
      input.inputMode = 'decimal';
      item.appendChild(label);
      item.appendChild(input);
    }
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
    const title = record.Description || record.FeeCategory || record.Department || record.RecordType || 'Payment record';
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${title}</strong>
      <span>${record.Date || ''}${period ? ' | ' + period : ''} | ${isCredit ? '+' : ''}${money(amount)}</span>
      <small>${record.RecordType || ''}${record.Status ? ' | Status: ' + record.Status : ''}${record.Reference ? ' | Ref: ' + record.Reference : ''}</small>
    `;
    paymentRecords.appendChild(item);
  });
}

function resultDisplayMode() {
  return window.SCHOOL_PROFILE?.ResultDisplayMode || 'subjects';
}

function renderEntranceResults(child) {
  const records = dashboard.entranceResults?.[child.AccountRef] || [];
  entranceResults.innerHTML = records.length ? '' : '<p class="muted">Entrance result is not available yet.</p>';
  records.forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    const percentage = record.ResultPercentage ? `${record.ResultPercentage}%` : '';
    const status = record.ResultStatus || 'Pending';
    const date = record.ResultUpdatedAt || record.ResultSentAt || '';
    if (resultDisplayMode() === 'percentage') {
      item.innerHTML = `
        <strong>${status}</strong>
        <span>${[percentage || 'Percentage not recorded', date].filter(Boolean).join(' | ')}</span>
        <small>${[record.ResultNotes, record.ResultNextStep].filter(Boolean).join(' | ')}</small>
      `;
    } else {
      item.innerHTML = `
        <strong>${status}${percentage ? ' | ' + percentage : ''}</strong>
        <span>${date || ''}</span>
        <div class="result-scores">
          <span>English: <strong>${record.EnglishScore || '-'}</strong></span>
          <span>Mathematics: <strong>${record.MathematicsScore || '-'}</strong></span>
          <span>Interview / General: <strong>${record.InterviewScore || '-'}</strong></span>
          <span>Total: <strong>${record.TotalScore || '-'}</strong></span>
        </div>
        <small>${[record.ResultNotes, record.ResultNextStep].filter(Boolean).join(' | ')}</small>
      `;
    }
    entranceResults.appendChild(item);
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
  renderEntranceResults(child);
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
  loadedPayables.clear();
  selectedAccountRef = data.children?.[0]?.AccountRef || '';
  dashboardContent.hidden = false;
  renderDashboard();
  loadPayablesForSelected();
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

if (refreshDashboardBtn) {
  refreshDashboardBtn.addEventListener('click', async () => {
    try {
      await loadDashboard();
    } catch (error) {
      setStatus(error.message, 'bad');
    }
  });
}
