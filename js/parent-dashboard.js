const loginForm = document.getElementById('parentLoginForm');
const statusEl = document.getElementById('parentStatus');
const dashboardContent = document.getElementById('dashboardContent');
const childrenList = document.getElementById('childrenList');
const walletSummary = document.getElementById('walletSummary');
const walletLedger = document.getElementById('walletLedger');
const dueNotifications = document.getElementById('dueNotifications');
const payableItems = document.getElementById('payableItems');
const accountCreditSummary = document.getElementById('accountCreditSummary');
const paymentRecords = document.getElementById('paymentRecords');
const entranceResultPanel = document.getElementById('entranceResultPanel');
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

function freshBody(payload) {
  return JSON.stringify({
    ...payload,
    _ts: Date.now()
  });
}

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
      loadPayablesForSelected(true);
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
  if (entries.length > 5) {
    const details = document.createElement('details');
    details.className = 'collapsible-activity';
    const summary = document.createElement('summary');
    summary.textContent = `Show ${entries.length} wallet purchase / top-up activities`;
    details.appendChild(summary);
    walletLedger.appendChild(details);
    entries.slice(0, 100).forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      item.innerHTML = `
        <strong>${entry.Description || entry.EntryType || 'Wallet activity'}</strong>
        <span>${entry.Date || ''} | ${entry.Debit ? '-' + money(entry.Debit) : '+' + money(entry.Credit)}</span>
        <small>${entry.RecordedBy || entry.Source || ''}</small>
      `;
      details.appendChild(item);
    });
    return;
  }
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

function accountSummaryFor(child) {
  const summary = dashboard.accountSummaries?.[child.AccountRef] || child || {};
  const totalDebit = Number(String(summary.TotalDebit || '0').replace(/,/g, ''));
  const totalCredit = Number(String(summary.TotalCredit || '0').replace(/,/g, ''));
  const outstanding = Number(String(summary.OutstandingBalance || '0').replace(/,/g, ''));
  const creditBalance = Number(String(summary.CreditBalance || '0').replace(/,/g, ''));
  return {
    TotalDebit: Number.isFinite(totalDebit) ? totalDebit : 0,
    TotalCredit: Number.isFinite(totalCredit) ? totalCredit : 0,
    OutstandingBalance: Number.isFinite(outstanding) ? outstanding : 0,
    CreditBalance: Number.isFinite(creditBalance) ? creditBalance : 0
  };
}

function renderAccountCredit(child) {
  if (!accountCreditSummary) return;
  const summary = accountSummaryFor(child);
  const creditNote = summary.CreditBalance > 0
    ? `<p class="credit-note">This credit will be applied automatically to future school charges unless Accounts refunds or reallocates it.</p>`
    : '';
  accountCreditSummary.innerHTML = `
    <div><strong>${money(summary.TotalDebit)}</strong><span>Total Fee Charges</span></div>
    <div><strong>${money(summary.TotalCredit)}</strong><span>Total Fee Payments</span></div>
    <div><strong>${money(summary.OutstandingBalance)}</strong><span>Outstanding Balance</span></div>
    <div class="${summary.CreditBalance > 0 ? 'credit-good' : ''}"><strong>${money(summary.CreditBalance)}</strong><span>Credit Balance</span></div>
    ${creditNote}
  `;
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function isWalletFee(fee) {
  return String(fee.FeeCode || '').trim() === 'WALLET_TOPUP' || String(fee.FeeCategory || '').trim().toLowerCase() === 'wallet';
}

function feeCategory(fee) {
  return String(fee.FeeCategory || '').trim().toLowerCase();
}

function isBusFee(fee) {
  return feeCategory(fee) === 'bus service' || feeCategory(fee) === 'transport';
}

function isClubFee(fee) {
  return feeCategory(fee) === 'club';
}

function isOtherOptionalFee(fee) {
  return ['optional', 'others'].includes(feeCategory(fee));
}

function busModeFor(fee) {
  const text = `${fee.FeeName || ''} ${fee.FeeCode || ''}`.toLowerCase();
  if (text.includes('one way') || text.includes('one-way') || text.includes('single')) return 'One Way';
  if (text.includes('two way') || text.includes('two-way') || text.includes('return')) return 'Two Way';
  return 'General';
}

function busRouteFor(fee) {
  let name = String(fee.FeeName || fee.FeeCode || 'Bus Route').trim();
  name = name
    .replace(/bus\s*route/ig, '')
    .replace(/bus\s*service/ig, '')
    .replace(/transport/ig, '')
    .replace(/one[-\s]*way/ig, '')
    .replace(/two[-\s]*way/ig, '')
    .replace(/return/ig, '')
    .replace(/single/ig, '')
    .replace(/^[\s:|/-]+|[\s:|/-]+$/g, '')
    .trim();
  return name || 'Route';
}

function clubNameFor(fee) {
  return String(fee.FeeName || fee.FeeCode || 'Club').replace(/paid\s*club|club\s*subscription/ig, '').replace(/^[\s:|/-]+|[\s:|/-]+$/g, '').trim() || String(fee.FeeName || fee.FeeCode || 'Club');
}

function optionalNameFor(fee) {
  return String(fee.FeeName || fee.FeeCode || 'Optional Service').replace(/optional\s*service|others/ig, '').replace(/^[\s:|/-]+|[\s:|/-]+$/g, '').trim() || String(fee.FeeName || fee.FeeCode || 'Optional Service');
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

function renderSubscriptionSelector(child, title, fees, options = {}) {
  if (!fees.length) return null;
  const box = document.createElement('div');
  box.className = 'activity-item payment-action subscription-selector';
  const selectedFee = { current: null };
  const status = document.createElement('small');
  status.className = 'payment-status status';
  const amountLine = document.createElement('span');
  amountLine.className = 'subscription-amount muted';

  const heading = document.createElement('strong');
  heading.textContent = title;
  box.appendChild(heading);

  const routeSelect = document.createElement('select');
  const modeSelect = document.createElement('select');
  const clubSelect = document.createElement('select');

  if (options.kind === 'bus') {
    const routes = [...new Set(fees.map(busRouteFor))].sort();
    routes.forEach((route) => {
      const opt = document.createElement('option');
      opt.value = route;
      opt.textContent = route;
      routeSelect.appendChild(opt);
    });
    ['One Way', 'Two Way', 'General'].forEach((mode) => {
      if (!fees.some((fee) => busModeFor(fee) === mode)) return;
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode;
      modeSelect.appendChild(opt);
    });
    box.appendChild(document.createTextNode('Route'));
    box.appendChild(routeSelect);
    box.appendChild(document.createTextNode('Mode'));
    box.appendChild(modeSelect);
  } else {
    fees.forEach((fee, index) => {
      const opt = document.createElement('option');
      opt.value = String(index);
      const label = options.kind === 'club' ? clubNameFor(fee) : optionalNameFor(fee);
      opt.textContent = `${label} - ${money(fee.Amount)}`;
      clubSelect.appendChild(opt);
    });
    box.appendChild(document.createTextNode(options.kind === 'club' ? 'Club' : 'Item'));
    box.appendChild(clubSelect);
  }

  function chooseFee() {
    if (options.kind === 'bus') {
      selectedFee.current = fees.find((fee) => busRouteFor(fee) === routeSelect.value && busModeFor(fee) === modeSelect.value) || null;
    } else {
      selectedFee.current = fees[Number(clubSelect.value || 0)] || null;
    }
    amountLine.textContent = selectedFee.current
      ? `Amount: ${money(selectedFee.current.Amount)}${selectedFee.current.Term ? ' | ' + selectedFee.current.Term : ''}`
      : 'No price has been set for this selection.';
    status.textContent = '';
    status.className = 'payment-status status';
  }

  routeSelect.addEventListener('change', chooseFee);
  modeSelect.addEventListener('change', chooseFee);
  clubSelect.addEventListener('change', chooseFee);

  const loadButton = document.createElement('button');
  loadButton.type = 'button';
  loadButton.textContent = 'Load Amount';
  const payButton = document.createElement('button');
  payButton.type = 'button';
  payButton.textContent = 'Pay Selected';
  payButton.disabled = true;
  loadButton.addEventListener('click', () => {
    chooseFee();
    if (!selectedFee.current) {
      status.textContent = 'No matching amount was found for this selection.';
      status.className = 'payment-status status bad';
      payButton.disabled = true;
      return;
    }
    status.textContent = 'Amount loaded. Click Pay Selected to continue.';
    status.className = 'payment-status status ok';
    payButton.disabled = false;
  });
  payButton.addEventListener('click', () => {
    chooseFee();
    if (!selectedFee.current) {
      status.textContent = 'No matching amount was found for this selection.';
      status.className = 'payment-status status bad';
      payButton.disabled = true;
      return;
    }
    payItem(child, selectedFee.current, box);
  });
  box.appendChild(amountLine);
  box.appendChild(loadButton);
  box.appendChild(payButton);
  box.appendChild(status);
  chooseFee();
  return box;
}

function activityTarget(container, records, label) {
  container.innerHTML = '';
  if ((records || []).length <= 5) return container;
  const details = document.createElement('details');
  details.className = 'collapsible-activity';
  const summary = document.createElement('summary');
  summary.textContent = `Show ${records.length} ${label}`;
  details.appendChild(summary);
  container.appendChild(details);
  return details;
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

async function loadPayablesForSelected(force = false) {
  const child = selectedChild();
  if (!child) return;
  if (!force && loadedPayables.has(child.AccountRef)) return;
  loadedPayables.delete(child.AccountRef);
  loadedPayables.add(child.AccountRef);
  dashboard.payableItems = dashboard.payableItems || {};
  dashboard.payableErrors = dashboard.payableErrors || {};
  dashboard.dueNotifications = dashboard.dueNotifications || {};
  dashboard.accountSummaries = dashboard.accountSummaries || {};
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
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
        action: 'getChildPayable',
        ...baseBody
      })
    });
    const activityRequest = fetch('/api/parent-dashboard', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
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
      if (activityData.accountSummary) {
        dashboard.accountSummaries[child.AccountRef] = activityData.accountSummary;
        Object.assign(child, activityData.accountSummary);
      }
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
  renderAccountCredit(child);
  renderWallet(child);
  renderPayments(child);
  renderClinic(child);
  renderEntranceResults(child);
}

function amountInputId(fee) {
  return `amount-${String(fee.FeeCode || 'fee').replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

function setPaymentStatus(container, message, type) {
  const target = container && container.querySelector('.payment-status');
  if (!target) {
    setStatus(message, type);
    return;
  }
  target.textContent = message || '';
  target.className = 'payment-status status ' + (type || '');
}

function paymentAmountFor(fee, container) {
  const input = document.getElementById(amountInputId(fee));
  const amount = Number(String(fee.Amount || '0').replace(/,/g, ''));
  const max = Number(String(fee.MaxAmount || '0').replace(/,/g, ''));
  if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
    setPaymentStatus(container, 'This wallet has reached the maximum balance allowed for this class.', 'bad');
    return null;
  }
  if (!isWalletFee(fee) && !isYes(fee.AllowInstallment)) return amount;
  const min = Number(String(fee.MinAmount || '0').replace(/,/g, ''));
  const entered = input ? input.value : '';
  const value = Number(String(entered || '0').replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) {
    setPaymentStatus(container, 'Enter a valid amount.', 'bad');
    return null;
  }
  if (Number.isFinite(min) && min > 0 && value < min) {
    setPaymentStatus(container, `Minimum amount is ${money(min)}.`, 'bad');
    return null;
  }
  const limit = isWalletFee(fee) && Number.isFinite(max) && max > 0 ? max : amount;
  if (Number.isFinite(limit) && limit > 0 && value > limit) {
    setPaymentStatus(container, `Maximum amount is ${money(limit)}.`, 'bad');
    return null;
  }
  setPaymentStatus(container, '', '');
  return value;
}

async function payItem(child, fee, container) {
  const amount = paymentAmountFor(fee, container);
  if (amount === null) return;
  try {
    setPaymentStatus(container, 'Starting secure checkout...', '');
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
    setPaymentStatus(container, error.message, 'bad');
  }
}

function renderPayableItems(child) {
  const records = dashboard.payableItems?.[child.AccountRef] || [];
  const busFees = records.filter(isBusFee);
  const clubFees = records.filter(isClubFee);
  const otherFees = records.filter(isOtherOptionalFee);
  const directRecords = records.filter((fee) => !isBusFee(fee) && !isClubFee(fee) && !isOtherOptionalFee(fee));
  const payableError = dashboard.payableErrors?.[child.AccountRef] || '';
  const loading = !loadedPayables.has(child.AccountRef);
  payableItems.innerHTML = records.length ? '' : `<p class="${payableError ? 'status bad' : 'muted'}">${payableError || (loading ? 'Loading payable items...' : 'There are no online payment items due at the moment.')}</p>`;
  if (busFees.length || clubFees.length || otherFees.length) {
    const optionalBox = document.createElement('div');
    optionalBox.className = 'activity-item optional-payments';
    const optionalHeading = document.createElement('strong');
    optionalHeading.textContent = 'Other Optional Payments';
    optionalBox.appendChild(optionalHeading);
    const busSelector = renderSubscriptionSelector(child, 'Bus Service Subscription', busFees, { kind: 'bus' });
    if (busSelector) optionalBox.appendChild(busSelector);
    const clubSelector = renderSubscriptionSelector(child, 'Paid Club Subscription', clubFees, { kind: 'club' });
    if (clubSelector) optionalBox.appendChild(clubSelector);
    const otherSelector = renderSubscriptionSelector(child, 'Other Optional Item', otherFees, { kind: 'others' });
    if (otherSelector) optionalBox.appendChild(otherSelector);
    payableItems.appendChild(optionalBox);
  }
  directRecords.forEach((fee) => {
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
    if (isWalletFee(fee) && Number(fee.WalletLimit || 0) > 0) {
      const walletNote = document.createElement('small');
      walletNote.textContent = `Wallet balance: ${money(fee.WalletBalance)} | Class wallet limit: ${money(fee.WalletLimit)} | Maximum top-up now: ${money(fee.MaxAmount || fee.Amount)}`;
      item.appendChild(walletNote);
    }
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
      if (fee.MaxAmount) input.max = fee.MaxAmount;
      input.step = '0.01';
      input.value = defaultAmount;
      input.inputMode = 'decimal';
      if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
        input.disabled = true;
        input.value = '';
      }
      item.appendChild(label);
      item.appendChild(input);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Pay Now';
    if (isWalletFee(fee) && isYes(fee.WalletLimitReached)) {
      button.disabled = true;
    }
    button.addEventListener('click', () => payItem(child, fee, item));
    item.appendChild(button);
    const inlineStatus = document.createElement('small');
    inlineStatus.className = 'payment-status status';
    item.appendChild(inlineStatus);
    payableItems.appendChild(item);
  });
}

function renderClinic(child) {
  const records = dashboard.clinicVisits?.[child.AccountRef] || [];
  if (!records.length) {
    clinicRecords.innerHTML = '<p class="muted">No clinic visits found.</p>';
    return;
  }
  const target = activityTarget(clinicRecords, records, 'clinic visits');
  records.slice(0, 100).forEach((record) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${record.Complaint || 'Clinic visit'}</strong>
      <span>${record.Date || ''} | ${record.Disposition || ''}</span>
      <small>${record.Treatment || ''}</small>
    `;
    target.appendChild(item);
  });
}

function renderPayments(child) {
  const records = dashboard.paymentRecords?.[child.AccountRef] || [];
  if (!records.length) {
    paymentRecords.innerHTML = '<p class="muted">No payment records found.</p>';
    return;
  }
  const target = activityTarget(paymentRecords, records, 'payment records');
  records.slice(0, 100).forEach((record) => {
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
    target.appendChild(item);
  });
}

function resultDisplayMode() {
  return window.SCHOOL_PROFILE?.ResultDisplayMode || 'subjects';
}

function resultsOnlineEnabled() {
  const profileValue = String(window.SCHOOL_PROFILE?.ShowResultsOnline || '').trim().toUpperCase();
  if (profileValue) return profileValue === 'YES';
  return dashboard?.showResultsOnline === true;
}

function renderEntranceResults(child) {
  if (entranceResultPanel) {
    entranceResultPanel.hidden = !resultsOnlineEnabled();
  }
  if (!resultsOnlineEnabled()) {
    entranceResults.innerHTML = '';
    return;
  }
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
  renderAccountCredit(child);
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
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: freshBody({ action: 'getDashboard', ...payload })
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
  await loadPayablesForSelected(true);
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
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: freshBody({
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

window.addEventListener('school-profile-ready', () => {
  const child = selectedChild();
  if (child) renderEntranceResults(child);
});
