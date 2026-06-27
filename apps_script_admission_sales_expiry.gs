// Destiny Christian Academy - Admission Form Sale Sync + Verification
// Paste this into Google Apps Script attached to your Google Sheet.
// This version supports code expiry and one-time use.

const SHARED_SECRET = 'CHANGE_THIS_TO_YOUR_PRIVATE_SECRET';
const SHEET_NAME = 'FormSales';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = [
    'Timestamp',
    'ReceiptNo',
    'ApplicantName',
    'Email',
    'Phone',
    'ClassApplyingFor',
    'AmountPaid',
    'FormLink',
    'VerificationCode',
    'PaymentDate',
    'ExpiryDate',
    'Status',
    'Used',
    'UsedAt'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    // Add any missing columns without deleting existing data.
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headers.forEach(function(header) {
      if (existingHeaders.indexOf(header) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      }
    });
  }

  return sheet;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseDateOnly_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value).trim();
  const parts = text.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (!year || month < 0 || !day) return null;
  return new Date(year, month, day);
}

function isExpired_(expiryValue) {
  const expiry = parseDateOnly_(expiryValue);
  if (!expiry) return false;
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return todayOnly > expiry;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');

    if (String(data.Secret || '') !== SHARED_SECRET) {
      return json_({ ok: false, message: 'Unauthorized' });
    }

    const sheet = getSheet_();

    const email = String(data.Email || '').trim().toLowerCase();
    const code = String(data.VerificationCode || '').trim().toUpperCase();

    if (!email || !code) {
      return json_({ ok: false, message: 'Email and VerificationCode are required' });
    }

    sheet.appendRow([
      new Date(),
      data.ReceiptNo || '',
      data.ApplicantName || '',
      email,
      data.Phone || '',
      data.ClassApplyingFor || '',
      data.AmountPaid || '',
      data.FormLink || '',
      code,
      data.PaymentDate || '',
      data.ExpiryDate || '',
      data.Status || 'PAID',
      data.Used || 'NO',
      ''
    ]);

    return json_({ ok: true, message: 'Saved to Google Sheet' });
  } catch (err) {
    return json_({ ok: false, message: String(err) });
  }
}

function doGet(e) {
  try {
    const action = String(e.parameter.action || '').trim().toLowerCase();

    if (action !== 'verify') {
      return json_({ ok: false, message: 'Invalid action' });
    }

    if (String(e.parameter.secret || '') !== SHARED_SECRET) {
      return json_({ ok: false, message: 'Unauthorized' });
    }

    const email = String(e.parameter.email || '').trim().toLowerCase();
    const code = String(e.parameter.code || '').trim().toUpperCase();

    if (!email || !code) {
      return json_({ ok: false, message: 'Email and code are required' });
    }

    const sheet = getSheet_();
    const values = sheet.getDataRange().getValues();
    const headers = values[0];

    const emailCol = headers.indexOf('Email');
    const codeCol = headers.indexOf('VerificationCode');
    const statusCol = headers.indexOf('Status');
    const usedCol = headers.indexOf('Used');
    const usedAtCol = headers.indexOf('UsedAt');
    const expiryCol = headers.indexOf('ExpiryDate');
    const nameCol = headers.indexOf('ApplicantName');
    const receiptCol = headers.indexOf('ReceiptNo');

    for (let i = 1; i < values.length; i++) {
      const rowEmail = String(values[i][emailCol] || '').trim().toLowerCase();
      const rowCode = String(values[i][codeCol] || '').trim().toUpperCase();
      const rowStatus = String(values[i][statusCol] || '').trim().toUpperCase();
      const rowUsed = String(values[i][usedCol] || '').trim().toUpperCase();
      const rowExpiry = expiryCol >= 0 ? values[i][expiryCol] : '';

      if (rowEmail === email && rowCode === code && rowStatus === 'PAID') {
        if (rowUsed === 'YES') {
          return json_({ ok: false, message: 'This code has already been used' });
        }

        if (isExpired_(rowExpiry)) {
          return json_({ ok: false, message: 'This verification code has expired' });
        }

        sheet.getRange(i + 1, usedCol + 1).setValue('YES');
        if (usedAtCol >= 0) {
          sheet.getRange(i + 1, usedAtCol + 1).setValue(new Date());
        }

        return json_({
          ok: true,
          message: 'Verified',
          applicantName: values[i][nameCol] || '',
          receiptNo: values[i][receiptCol] || '',
          expiryDate: rowExpiry || ''
        });
      }
    }

    return json_({ ok: false, message: 'Invalid email or verification code' });
  } catch (err) {
    return json_({ ok: false, message: String(err) });
  }
}
