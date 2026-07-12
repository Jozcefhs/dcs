const loginForm = document.getElementById('adminLogin');
const passwordInput = document.getElementById('adminPassword');
const statusEl = document.getElementById('adminStatus');
const dashboardEl = document.getElementById('adminDashboard');
const summaryEl = document.getElementById('adminSummary');
const tabsEl = document.getElementById('adminTabs');
const panelEl = document.getElementById('adminPanel');

let adminPassword = '';
let dashboardData = null;

const tabConfig = [
  ['admissions', 'Admissions'],
  ['formPurchases', 'Form Purchases'],
  ['students', 'Students'],
  ['accounts', 'Accounts'],
  ['clinic', 'Clinic'],
  ['kitchen', 'Kitchen'],
  ['tuckShop', 'Tuck Shop']
];

function setStatus(message, type = '') {
  statusEl.textContent = message || '';
  statusEl.className = type ? `status ${type}` : 'status';
}

function text(value) {
  return String(value ?? '').trim();
}

function money(value) {
  const amount = Number(String(value ?? '0').replace(/[₦,\s]/g, ''));
  if (!Number.isFinite(amount)) return text(value);
  return `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

async function loadDashboard() {
  setStatus('Loading dashboard...');
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword })
  });
  const data = await res.json().catch(() => ({ ok: false, message: 'Admin API did not return JSON.' }));
  if (!res.ok || !data.ok) throw new Error(data.message || 'Could not load admin dashboard.');
  dashboardData = data;
  renderDashboard('admissions');
  dashboardEl.hidden = false;
  setStatus('Dashboard loaded.', 'ok');
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
    ['Low Stock', Number(summary.lowClinicStock || 0) + Number(summary.lowKitchenStock || 0)]
  ];
  summaryEl.innerHTML = items.map(([label, value]) => `<div><strong>${value || 0}</strong><span>${label}</span></div>`).join('');
}

function renderTabs(active) {
  tabsEl.innerHTML = tabConfig.map(([key, label]) => {
    const selected = key === active ? ' selected' : '';
    return `<button type="button" class="child-card${selected}" data-tab="${key}">${label}</button>`;
  }).join('');
  tabsEl.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => renderDashboard(button.dataset.tab));
  });
}

function table(title, rows, columns) {
  const body = rows && rows.length
    ? rows.map((row) => `<tr>${columns.map((col) => `<td>${text(col.value(row))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">No records found.</td></tr>`;
  return `
    <h2>${title}</h2>
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>${columns.map((col) => `<th>${col.label}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderDashboard(active) {
  if (!dashboardData) return;
  renderSummary(dashboardData.summary || {});
  renderTabs(active);
  const departments = dashboardData.departments || {};
  if (active === 'admissions') {
    panelEl.innerHTML = table('Admissions', departments.admissions || [], [
      { label: 'Reference', value: (row) => pick(row, ['ApplicationReference', 'ApplicationID', '__id']) },
      { label: 'Name', value: (row) => pick(row, ['ApplicantName', 'Name']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor', 'ClassAppliedFor']) },
      { label: 'Status', value: (row) => pick(row, ['Status', 'ResultStatus']) },
      { label: 'Duplicate', value: (row) => pick(row, ['DuplicateWarning']) }
    ]);
  } else if (active === 'formPurchases') {
    panelEl.innerHTML = table('Admission Form Purchases', departments.formPurchases || [], [
      { label: 'Receipt', value: (row) => pick(row, ['ReceiptNo', '__id']) },
      { label: 'Applicant', value: (row) => pick(row, ['ApplicantName']) },
      { label: 'Email', value: (row) => pick(row, ['Email']) },
      { label: 'Class', value: (row) => pick(row, ['ClassApplyingFor']) },
      { label: 'Amount', value: (row) => pick(row, ['AmountPaid', 'Amount']) },
      { label: 'Expiry', value: (row) => pick(row, ['ExpiryDate']) }
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
  }
}

function inventoryColumns() {
  return [
    { label: 'Item', value: (row) => pick(row, ['ItemName', '__id']) },
    { label: 'Category', value: (row) => pick(row, ['Category']) },
    { label: 'Unit', value: (row) => pick(row, ['Unit']) },
    { label: 'Qty', value: (row) => pick(row, ['Quantity']) },
    { label: 'Reorder', value: (row) => pick(row, ['ReorderLevel']) }
  ];
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  adminPassword = passwordInput.value;
  try {
    await loadDashboard();
  } catch (err) {
    setStatus(err.message || String(err), 'bad');
  }
});
