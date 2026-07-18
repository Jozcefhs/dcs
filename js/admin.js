const loginCard = document.getElementById('staffLoginCard');
const loginForm = document.getElementById('staffLoginForm');
const loginButton = document.getElementById('staffLoginButton');
const loginStatus = document.getElementById('staffLoginStatus');
const dashboardEl = document.getElementById('staffDashboard');
const dashboardStatus = document.getElementById('staffDashboardStatus');
const identityEl = document.getElementById('staffIdentity');
const displayNameEl = document.getElementById('staffDisplayName');
const roleEl = document.getElementById('staffRole');
const welcomeTitle = document.getElementById('staffWelcomeTitle');
const signOutButton = document.getElementById('staffSignOut');
const refreshButton = document.getElementById('staffRefresh');
const summaryEl = document.getElementById('adminSummary');
const tabsEl = document.getElementById('adminTabs');
const panelEl = document.getElementById('adminPanel');

let currentUser = null;
let dashboardData = null;
let activeSection = '';
let financeData = null;

const tabConfig = [
  ['admissions', 'Admissions'],
  ['formPurchases', 'Form Purchases'],
  ['students', 'Students'],
  ['accounts', 'Accounts'],
  ['financeRequests', 'Bills & Requisitions'],
  ['clinic', 'Clinic'],
  ['kitchen', 'Kitchen'],
  ['tuckShop', 'Tuck Shop']
];

function clean(value) {
  return String(value ?? '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && clean(row[key]) !== '') return row[key];
  }
  return '';
}

function money(value) {
  const amount = Number(String(value ?? '0').replace(/[₦,\s]/g, ''));
  return Number.isFinite(amount)
    ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount)
    : clean(value);
}

function setStatus(element, message, type = '') {
  element.textContent = message || '';
  element.className = type ? `status ${type}` : 'status';
}

function setButtonLoading(button, loading, loadingText, normalText) {
  button.disabled = loading;
  button.classList.toggle('is-loading', loading);
  button.setAttribute('aria-busy', loading ? 'true' : 'false');
  button.textContent = loading ? loadingText : normalText;
}

function showLogin(message = '', type = '') {
  currentUser = null;
  dashboardData = null;
  activeSection = '';
  dashboardEl.hidden = true;
  identityEl.hidden = true;
  loginCard.hidden = false;
  setStatus(loginStatus, message, type);
}

function showDashboard(user) {
  currentUser = user;
  displayNameEl.textContent = user.displayName || user.username;
  roleEl.textContent = [user.role, user.department].filter(Boolean).join(' • ');
  welcomeTitle.textContent = `Welcome, ${user.displayName || user.username}`;
  loginCard.hidden = true;
  identityEl.hidden = false;
  dashboardEl.hidden = false;
}

async function sessionRequest(method = 'GET', body = null) {
  const response = await fetch('/api/staff-session', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Staff authentication did not return JSON.' }));
  return { response, data };
}

async function loadDashboard() {
  setButtonLoading(refreshButton, true, 'Refreshing...', 'Refresh Dashboard');
  setStatus(dashboardStatus, 'Loading permitted Firestore records...');
  try {
    const response = await fetch('/api/admin', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({ ok: false, message: 'Staff dashboard did not return JSON.' }));
    if (response.status === 401) {
      showLogin(data.message || 'Your staff session has expired.', 'bad');
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not load staff dashboard.');
    dashboardData = data;
    currentUser = data.user || currentUser;
    showDashboard(currentUser);
    renderSummary(data.summary || {});
    const allowed = data.allowedSections || currentUser.allowedSections || [];
    if (!activeSection || !allowed.includes(activeSection)) activeSection = allowed[0] || '';
    renderTabs(allowed);
    renderSection(activeSection);
    setStatus(dashboardStatus, 'Dashboard updated.', 'ok');
  } catch (error) {
    setStatus(dashboardStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(refreshButton, false, 'Refreshing...', 'Refresh Dashboard');
  }
}

function renderSummary(summary) {
  const items = [
    ['Applications', summary.applications],
    ['Students', summary.students],
    ['Form Purchases', summary.formPurchases],
    ['Payments', summary.payments],
    ['Invoices', summary.invoices],
    ['Clinic Records', summary.clinicRecords],
    ['Kitchen Items', summary.kitchenInventory],
    ['Tuck Shop Purchases', summary.tuckShopPurchases],
    ['Low Clinic Stock', summary.lowClinicStock],
    ['Low Kitchen Stock', summary.lowKitchenStock]
  ].filter(([, value]) => value !== undefined);
  summaryEl.innerHTML = items.map(([label, value]) => `<div><strong>${escapeHtml(value || 0)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function renderTabs(allowed) {
  const tabs = tabConfig.filter(([key]) => allowed.includes(key));
  tabsEl.innerHTML = tabs.map(([key, label]) => {
    const selected = key === activeSection ? ' selected' : '';
    return `<button type="button" class="child-card${selected}" data-tab="${escapeHtml(key)}" aria-selected="${key === activeSection}">${escapeHtml(label)}</button>`;
  }).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeSection = button.dataset.tab;
      renderTabs(allowed);
      renderSection(activeSection);
      panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function table(title, rows, columns) {
  const body = rows && rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(column.value(row))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">No records found.</td></tr>`;
  return `
    <h2>${escapeHtml(title)}</h2>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function inventoryColumns() {
  return [
    { label: 'Item', value: (row) => pick(row, ['ItemName', '__id']) },
    { label: 'Category', value: (row) => pick(row, ['Category']) },
    { label: 'Unit', value: (row) => pick(row, ['Unit']) },
    { label: 'Quantity', value: (row) => pick(row, ['Quantity']) },
    { label: 'Reorder Level', value: (row) => pick(row, ['ReorderLevel']) }
  ];
}

function renderSection(active) {
  if (!dashboardData) return;
  const departments = dashboardData.departments || {};
  if (active === 'financeRequests') {
    panelEl.innerHTML = '<p class="muted">Loading bills and requisitions...</p>';
    loadFinanceWorkflow();
  } else if (active === 'admissions') {
    panelEl.innerHTML = table('Admissions', departments.admissions || [], [
      { label: 'Reference', value: (row) => pick(row, ['ApplicationReference', 'ApplicationID', '__id']) },
      { label: 'Name', value: (row) => pick(row, ['ApplicantName', 'Name']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor', 'ClassAppliedFor']) },
      { label: 'Status', value: (row) => pick(row, ['Status', 'ResultStatus']) }
    ]);
  } else if (active === 'formPurchases') {
    panelEl.innerHTML = table('Admission Form Purchases', departments.formPurchases || [], [
      { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
      { label: 'Applicant', value: (row) => pick(row, ['ApplicantName']) },
      { label: 'Email', value: (row) => pick(row, ['Email']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor']) },
      { label: 'Amount', value: (row) => money(pick(row, ['AmountPaid', 'Amount'])) }
    ]);
  } else if (active === 'students') {
    panelEl.innerHTML = table('Students', departments.students || [], [
      { label: 'Admission No', value: (row) => pick(row, ['AdmissionNo', 'AccountRef', '__id']) },
      { label: 'Name', value: (row) => pick(row, ['DisplayName', 'ApplicantName', 'StudentName']) },
      { label: 'Class', value: (row) => [pick(row, ['ClassName']), pick(row, ['ClassArm'])].filter(Boolean).join(' ') },
      { label: 'Type', value: (row) => pick(row, ['StudentType']) },
      { label: 'Status', value: (row) => pick(row, ['Status']) }
    ]);
  } else if (active === 'accounts') {
    const accounts = departments.accounts || {};
    panelEl.innerHTML = table('Payments', accounts.payments || [], [
      { label: 'Date', value: (row) => pick(row, ['PaidAt', 'Date']) },
      { label: 'Account', value: (row) => pick(row, ['AccountRef', 'AdmissionNo']) },
      { label: 'Fee', value: (row) => pick(row, ['FeeName', 'FeeCode']) },
      { label: 'Amount', value: (row) => money(pick(row, ['Amount'])) },
      { label: 'Reference', value: (row) => pick(row, ['Reference']) }
    ]) + table('Invoices', accounts.invoices || [], [
      { label: 'Date', value: (row) => pick(row, ['Date', 'CreatedAt']) },
      { label: 'Account', value: (row) => pick(row, ['AccountRef']) },
      { label: 'Fee', value: (row) => pick(row, ['FeeName', 'FeeCode']) },
      { label: 'Debit', value: (row) => money(pick(row, ['Debit', 'Amount'])) },
      { label: 'Status', value: (row) => pick(row, ['Status']) }
    ]);
  } else if (active === 'clinic') {
    const clinic = departments.clinic || {};
    panelEl.innerHTML = table('Clinic Records', clinic.records || [], [
      { label: 'Date', value: (row) => pick(row, ['Date']) },
      { label: 'Student', value: (row) => pick(row, ['StudentName']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) },
      { label: 'Complaint', value: (row) => pick(row, ['Complaint']) },
      { label: 'Treatment', value: (row) => pick(row, ['Treatment']) }
    ]) + table('Low Stock', clinic.lowStock || [], inventoryColumns());
  } else if (active === 'kitchen') {
    const kitchen = departments.kitchen || {};
    panelEl.innerHTML = table('Kitchen Inventory', kitchen.inventory || [], inventoryColumns()) +
      table('Low Stock', kitchen.lowStock || [], inventoryColumns());
  } else if (active === 'tuckShop') {
    panelEl.innerHTML = table('Tuck Shop Wallet Purchases', (departments.tuckShop || {}).purchases || [], [
      { label: 'Date', value: (row) => pick(row, ['Date']) },
      { label: 'Student', value: (row) => pick(row, ['DisplayName']) },
      { label: 'Class', value: (row) => pick(row, ['ClassName']) },
      { label: 'Amount', value: (row) => money(pick(row, ['Debit'])) },
      { label: 'Description', value: (row) => pick(row, ['Description']) }
    ]);
  } else {
    panelEl.innerHTML = '<p class="muted">No dashboard section is available for this role yet.</p>';
  }
}

async function financeRequest(action, payload = {}) {
  const response = await fetch('/api/finance-workflow', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  const data = await response.json().catch(() => ({ ok: false, message: 'Finance workflow did not return JSON.' }));
  if (response.status === 401) {
    showLogin(data.message || 'Your staff session has expired.', 'bad');
    throw new Error(data.message || 'Your staff session has expired.');
  }
  if (!response.ok || !data.ok) throw new Error(data.message || 'Finance workflow request failed.');
  return data;
}

function financeRecordCard(record, type, capabilities) {
  const id = pick(record, type === 'bill' ? ['BillNo', '__id'] : ['ExpenseNo', '__id']);
  const status = pick(record, ['Status']) || 'Submitted';
  const title = type === 'bill'
    ? pick(record, ['VendorName', 'Vendor']) || 'Supplier Bill'
    : pick(record, ['Description']) || 'Requisition';
  const description = pick(record, ['Description']);
  const accountsReviewed = clean(record.AccountsReviewStatus).toLowerCase() === 'reviewed';
  let actions = '';
  if (capabilities.canApprove && clean(status).toLowerCase() === 'submitted') {
    actions += `<button type="button" class="workflow-approve" data-workflow-action="review" data-decision="Approved" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Approve</button>`;
    actions += `<button type="button" class="workflow-reject" data-workflow-action="review" data-decision="Rejected" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Reject</button>`;
  }
  if (capabilities.canAccountsReview && clean(status).toLowerCase() === 'approved' && !accountsReviewed) {
    actions += `<button type="button" data-workflow-action="accountsReview" data-record-type="${type}" data-record-id="${escapeHtml(id)}">Mark Accounts Reviewed</button>`;
  }
  return `
    <article class="workflow-record">
      <div class="workflow-record-heading">
        <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(id)}</small></div>
        <span class="workflow-status status-${escapeHtml(clean(status).toLowerCase().replace(/\s+/g, '-'))}">${escapeHtml(status)}</span>
      </div>
      <p>${escapeHtml(description)}</p>
      <div class="workflow-record-meta">
        <span><strong>${escapeHtml(money(record.Amount))}</strong>Amount</span>
        <span><strong>${escapeHtml(record.Department || '-')}</strong>Department</span>
        <span><strong>${escapeHtml(record.Date || '-')}</strong>Date</span>
        <span><strong>${escapeHtml(type === 'bill' ? (record.DueDate || '-') : (record.Vendor || '-'))}</strong>${type === 'bill' ? 'Due Date' : 'Vendor'}</span>
      </div>
      ${record.Notes ? `<small>Notes: ${escapeHtml(record.Notes)}</small>` : ''}
      ${record.ReviewNotes ? `<small>Review: ${escapeHtml(record.ReviewNotes)}</small>` : ''}
      ${accountsReviewed ? `<small class="status ok">Accounts reviewed by ${escapeHtml(record.AccountsReviewedBy || 'Accounts')}</small>` : ''}
      ${actions ? `<div class="workflow-actions">${actions}</div>` : ''}
    </article>
  `;
}

function financeRecordsSection(title, records, type, capabilities) {
  return `
    <section class="workflow-list-section">
      <h2>${escapeHtml(title)} <small>(${records.length})</small></h2>
      <div class="workflow-record-list">
        ${records.length ? records.map((record) => financeRecordCard(record, type, capabilities)).join('') : '<p class="muted">No records found.</p>'}
      </div>
    </section>
  `;
}

function renderFinanceWorkflow() {
  if (!financeData || activeSection !== 'financeRequests') return;
  const capabilities = financeData.capabilities || {};
  const department = financeData.department || 'Unassigned';
  const requisitions = financeData.requisitions || [];
  const bills = financeData.bills || [];
  const allRecords = [...requisitions, ...bills];
  const statusCount = (status) => allRecords.filter((record) => clean(record.Status).toLowerCase() === status).length;
  const pendingValue = allRecords
    .filter((record) => clean(record.Status).toLowerCase() === 'submitted')
    .reduce((sum, record) => sum + Number(record.Amount || 0), 0);
  const submissionDialogs = capabilities.canSubmit ? `
      <dialog id="requisitionDialog" class="workflow-dialog">
        <div class="workflow-dialog-header"><div><small>${escapeHtml(department)}</small><h2>New Expense Requisition</h2></div><button type="button" data-close-dialog aria-label="Close">×</button></div>
        <form id="requisitionForm" class="workflow-form">
          <h3>Expense Requisition</h3>
          <label>Description <span class="required">*</span><textarea name="description" rows="3" required></textarea></label>
          <label>Amount <span class="required">*</span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" required></label>
          <label>Preferred vendor<input name="vendor"></label>
          <label>Required date<input name="date" type="date"></label>
          <label>Reference<input name="reference"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit">Submit Requisition</button>
          <p class="status" data-form-status></p>
        </form>
      </dialog>
      <dialog id="supplierBillDialog" class="workflow-dialog">
        <div class="workflow-dialog-header"><div><small>${escapeHtml(department)}</small><h2>New Supplier Bill</h2></div><button type="button" data-close-dialog aria-label="Close">×</button></div>
        <form id="supplierBillForm" class="workflow-form">
          <h3>Supplier Bill</h3>
          <label>Supplier <span class="required">*</span><input name="vendorName" required></label>
          <label>Invoice reference<input name="invoiceReference"></label>
          <label>Description <span class="required">*</span><textarea name="description" rows="3" required></textarea></label>
          <label>Amount <span class="required">*</span><input name="amount" type="number" min="1" step="0.01" inputmode="decimal" required></label>
          <label>Bill date<input name="date" type="date"></label>
          <label>Due date<input name="dueDate" type="date"></label>
          <label>Supporting document URL<input name="attachmentUrl" type="url"></label>
          <label>Notes<textarea name="notes" rows="2"></textarea></label>
          <button type="submit">Submit Supplier Bill</button>
          <p class="status" data-form-status></p>
        </form>
      </dialog>
  ` : '';

  panelEl.innerHTML = `
    <div class="workflow-intro">
      <div><p class="eyebrow">Department finance</p><h2>Bills & Requisitions</h2><p class="muted">${escapeHtml(department)} workspace</p></div>
      <div class="workflow-primary-actions">
        ${capabilities.canSubmit ? '<button type="button" data-open-dialog="requisitionDialog">+ New Requisition</button><button type="button" class="workflow-secondary-action" data-open-dialog="supplierBillDialog">+ Supplier Bill</button>' : ''}
        <button type="button" class="workflow-icon-action" id="refreshFinanceWorkflow" aria-label="Refresh requests">Refresh</button>
      </div>
    </div>
    <p id="financeWorkflowStatus" class="status"></p>
    ${!capabilities.canSubmit ? '<p class="status bad">A department must be assigned to your staff account before you can submit requests.</p>' : ''}
    <div class="workflow-kpis">
      <div><small>Awaiting Approval</small><strong>${statusCount('submitted')}</strong><span>${escapeHtml(money(pendingValue))} pending</span></div>
      <div><small>Approved</small><strong>${statusCount('approved')}</strong><span>Ready for Accounts</span></div>
      <div><small>Rejected</small><strong>${statusCount('rejected')}</strong><span>Requires attention</span></div>
      <div><small>Total Records</small><strong>${allRecords.length}</strong><span>Current view</span></div>
    </div>
    <div class="workflow-ledger-heading"><div><h2>Recent Transactions</h2><p class="muted">Requisitions and bills synchronized with desktop accounting</p></div></div>
    ${financeRecordsSection('Expense Requisitions', requisitions, 'requisition', capabilities)}
    ${financeRecordsSection('Supplier Bills', bills, 'bill', capabilities)}
    ${submissionDialogs}
  `;
  bindFinanceWorkflowEvents();
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function bindSubmissionForm(formId, action, successText) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[data-form-status]');
    setButtonLoading(button, true, 'Submitting...', button.dataset.normalText || button.textContent);
    if (!button.dataset.normalText) button.dataset.normalText = action === 'submitBill' ? 'Submit Supplier Bill' : 'Submit Requisition';
    setStatus(status, 'Saving to Firestore...');
    try {
      await financeRequest(action, formPayload(form));
      form.reset();
      setStatus(status, successText, 'ok');
      await loadFinanceWorkflow();
    } catch (error) {
      setStatus(status, error.message || String(error), 'bad');
    } finally {
      setButtonLoading(button, false, 'Submitting...', button.dataset.normalText);
    }
  });
}

function bindFinanceWorkflowEvents() {
  document.getElementById('refreshFinanceWorkflow')?.addEventListener('click', loadFinanceWorkflow);
  panelEl.querySelectorAll('[data-open-dialog]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.openDialog)?.showModal());
  });
  panelEl.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });
  bindSubmissionForm('requisitionForm', 'submitRequisition', 'Requisition submitted.');
  bindSubmissionForm('supplierBillForm', 'submitBill', 'Supplier bill submitted.');
  panelEl.querySelectorAll('[data-workflow-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.workflowAction;
      const decision = button.dataset.decision || '';
      const notes = window.prompt(`${decision || 'Accounts review'} notes (optional):`, '');
      if (notes === null) return;
      const normalText = button.textContent;
      setButtonLoading(button, true, 'Saving...', normalText);
      try {
        const data = await financeRequest(action, {
          recordType: button.dataset.recordType,
          recordId: button.dataset.recordId,
          decision,
          notes
        });
        setStatus(document.getElementById('financeWorkflowStatus'), data.message, 'ok');
        await loadFinanceWorkflow();
      } catch (error) {
        setStatus(document.getElementById('financeWorkflowStatus'), error.message || String(error), 'bad');
      } finally {
        setButtonLoading(button, false, 'Saving...', normalText);
      }
    });
  });
}

async function loadFinanceWorkflow() {
  if (activeSection !== 'financeRequests') return;
  try {
    financeData = await financeRequest('list');
    renderFinanceWorkflow();
  } catch (error) {
    if (activeSection === 'financeRequests') panelEl.innerHTML = `<p class="status bad">${escapeHtml(error.message || String(error))}</p>`;
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loginButton.disabled) return;
  setButtonLoading(loginButton, true, 'Signing in...', 'Sign In');
  setStatus(loginStatus, 'Verifying staff account...');
  try {
    const { response, data } = await sessionRequest('POST', {
      action: 'login',
      username: document.getElementById('staffUsername').value.trim(),
      password: document.getElementById('staffPassword').value
    });
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not sign in.');
    loginForm.reset();
    showDashboard(data.user);
    await loadDashboard();
  } catch (error) {
    setStatus(loginStatus, error.message || String(error), 'bad');
  } finally {
    setButtonLoading(loginButton, false, 'Signing in...', 'Sign In');
  }
});

signOutButton.addEventListener('click', async () => {
  signOutButton.disabled = true;
  try {
    await sessionRequest('POST', { action: 'logout' });
  } finally {
    signOutButton.disabled = false;
    showLogin('Signed out successfully.', 'ok');
    document.getElementById('staffUsername').focus();
  }
});

refreshButton.addEventListener('click', loadDashboard);

(async function restoreSession() {
  setStatus(loginStatus, 'Checking staff session...');
  const { response, data } = await sessionRequest();
  if (response.ok && data.authenticated && data.user) {
    showDashboard(data.user);
    await loadDashboard();
  } else {
    showLogin();
  }
}());
