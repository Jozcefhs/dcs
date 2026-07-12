import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function toNumber(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function publicRows(rows, limit = 50) {
  return (rows || []).slice(0, limit).map((row) => {
    const copy = { ...row };
    delete copy.WalletPinHash;
    delete copy.PasswordHash;
    return copy;
  });
}

function requireAdmin(env, body) {
  const expected = clean(env.ADMIN_WEB_PASSWORD);
  if (!expected) {
    const err = new Error('Web admin login is not configured. Add ADMIN_WEB_PASSWORD in Cloudflare.');
    err.status = 500;
    throw err;
  }
  if (clean(body.password) !== expected) {
    const err = new Error('Invalid admin password.');
    err.status = 401;
    throw err;
  }
}

function sortRecent(rows, dateKeys) {
  return [...(rows || [])].sort((a, b) => {
    const av = dateKeys.map((key) => a[key]).find(Boolean) || '';
    const bv = dateKeys.map((key) => b[key]).find(Boolean) || '';
    return String(bv).localeCompare(String(av));
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const body = await request.json().catch(() => ({}));
    requireAdmin(env, body);

    const [
      applications,
      students,
      formSales,
      payments,
      invoices,
      ledger,
      clinicRecords,
      clinicInventory,
      kitchenInventory,
      clinicMovements,
      kitchenMovements
    ] = await Promise.all([
      listCollection(env, 'applications'),
      listCollection(env, 'students'),
      listCollection(env, 'formSales'),
      listCollection(env, 'payments'),
      listCollection(env, 'invoices'),
      listCollection(env, 'ledger'),
      listCollection(env, 'clinicRecords'),
      listCollection(env, 'clinicInventory'),
      listCollection(env, 'kitchenInventory'),
      listCollection(env, 'clinicMovements'),
      listCollection(env, 'kitchenMovements')
    ]);

    const walletPurchases = ledger.filter((row) => clean(row.EntryType).toLowerCase() === 'wallet purchase');
    const lowClinic = clinicInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));
    const lowKitchen = kitchenInventory.filter((row) => toNumber(row.ReorderLevel) > 0 && toNumber(row.Quantity) <= toNumber(row.ReorderLevel));

    return Response.json({
      ok: true,
      message: 'Admin dashboard loaded.',
      summary: {
        applications: applications.length,
        students: students.length,
        formPurchases: formSales.length,
        payments: payments.length,
        invoices: invoices.length,
        clinicRecords: clinicRecords.length,
        clinicInventory: clinicInventory.length,
        kitchenInventory: kitchenInventory.length,
        tuckShopPurchases: walletPurchases.length,
        lowClinicStock: lowClinic.length,
        lowKitchenStock: lowKitchen.length
      },
      departments: {
        admissions: publicRows(sortRecent(applications, ['SubmittedAt', 'UpdatedAt', 'Timestamp']), 80),
        students: publicRows(sortRecent(students, ['UpdatedAt', 'EnrolledAt', 'CreatedAt']), 80),
        formPurchases: publicRows(sortRecent(formSales, ['PaymentDate', 'UpdatedAt', 'CreatedAt']), 80),
        accounts: {
          payments: publicRows(sortRecent(payments, ['PaidAt', 'Date', 'RecordedAt']), 80),
          invoices: publicRows(sortRecent(invoices, ['Date', 'CreatedAt', 'DueDate']), 80),
          ledger: publicRows(sortRecent(ledger, ['Date', 'CreatedAt']), 100)
        },
        clinic: {
          records: publicRows(sortRecent(clinicRecords, ['Date', 'CreatedAt']), 80),
          inventory: publicRows(sortRecent(clinicInventory, ['LastUpdated', 'UpdatedAt']), 80),
          lowStock: publicRows(lowClinic, 80),
          movements: publicRows(sortRecent(clinicMovements, ['Date', 'CreatedAt']), 80)
        },
        kitchen: {
          inventory: publicRows(sortRecent(kitchenInventory, ['LastUpdated', 'UpdatedAt']), 80),
          lowStock: publicRows(lowKitchen, 80),
          movements: publicRows(sortRecent(kitchenMovements, ['Date', 'CreatedAt']), 80)
        },
        tuckShop: {
          purchases: publicRows(sortRecent(walletPurchases, ['Date', 'CreatedAt']), 100)
        }
      }
    });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, { status: err.status || 500 });
  }
}
