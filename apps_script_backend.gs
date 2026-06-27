// Destiny Christian Academy Admission Backend
// One Apps Script project handles:
// 1. Form-sale records from the desktop app -> FormSales sheet
// 2. Verification from website -> checks FormSales sheet
// 3. Completed application forms -> Applications sheet

const SHARED_SECRET = 'CHANGE_THIS_TO_YOUR_PRIVATE_SECRET';
const SALES_SHEET_NAME = 'FormSales';
const APPLICATIONS_SHEET_NAME = 'Applications';

const SALES_HEADERS = [
  'Timestamp', 'ReceiptNo', 'ApplicantName', 'Email', 'Phone', 'ClassApplyingFor',
  'AmountPaid', 'FormLink', 'VerificationCode', 'PaymentDate', 'ExpiryDate',
  'Status', 'Used', 'UsedAt'
];

const APPLICATION_HEADERS = [
  'SubmittedAt', 'VerificationEmail', 'VerificationCode', 'ReceiptNo',
  'Surname', 'FirstName', 'MiddleName', 'Gender', 'DateOfBirth', 'ClassApplyingFor',
  'Nationality', 'StateOfOrigin', 'LGA', 'PreviousSchool',
  'FatherName', 'FatherPhone', 'FatherEmail', 'FatherOccupation',
  'MotherName', 'MotherPhone', 'MotherEmail', 'MotherOccupation',
  'GuardianName', 'GuardianPhone', 'ResidentialAddress', 'CityArea', 'StateOfResidence',
  'BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName', 'EmergencyContactPhone',
  'StudentType', 'AcademicSession', 'HowHeard', 'DeclarationAccepted'
];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    headers.forEach(function(header) {
      if (existing.indexOf(header) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      }
    });
  }
  return sheet;
}

function parseDateOnly_(value) {
  if (!value) return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value).trim();
  const parts = text.split('-');
  if (parts.length !== 3) return null;
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}

function isExpired_(expiryValue) {
  const expiry = parseDateOnly_(expiryValue);
  if (!expiry) return false;
  const today = new Date();
  const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return todayOnly > expiry;
}

function findSaleRow_(email, code) {
  const sheet = getSheet_(SALES_SHEET_NAME, SALES_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const emailCol = headers.indexOf('Email');
  const codeCol = headers.indexOf('VerificationCode');

  for (let i = 1; i < values.length; i++) {
    const rowEmail = String(values[i][emailCol] || '').trim().toLowerCase();
    const rowCode = String(values[i][codeCol] || '').trim().toUpperCase();
    if (rowEmail === email && rowCode === code) {
      return { sheet, values, headers, rowIndex: i + 1, row: values[i] };
    }
  }
  return null;
}

function verifySale_(email, code, markUsed) {
  const found = findSaleRow_(email, code);
  if (!found) return { ok: false, message: 'Invalid email or verification code.' };

  const h = found.headers;
  const row = found.row;
  const status = String(row[h.indexOf('Status')] || '').trim().toUpperCase();
  const used = String(row[h.indexOf('Used')] || '').trim().toUpperCase();
  const expiry = row[h.indexOf('ExpiryDate')];

  if (status !== 'PAID') return { ok: false, message: 'This payment record is not active.' };
  if (used === 'YES') return { ok: false, message: 'This verification code has already been used.' };
  if (isExpired_(expiry)) return { ok: false, message: 'This verification code has expired.' };

  if (markUsed) {
    const usedCol = h.indexOf('Used') + 1;
    const usedAtCol = h.indexOf('UsedAt') + 1;
    found.sheet.getRange(found.rowIndex, usedCol).setValue('YES');
    found.sheet.getRange(found.rowIndex, usedAtCol).setValue(new Date());
  }

  return {
    ok: true,
    message: 'Verified',
    applicantName: row[h.indexOf('ApplicantName')] || '',
    receiptNo: row[h.indexOf('ReceiptNo')] || '',
    expiryDate: expiry || ''
  };
}

function doGet(e) {
  try {
    const action = String(e.parameter.action || '').trim();
    if (String(e.parameter.secret || '') !== SHARED_SECRET) return json_({ ok: false, message: 'Unauthorized.' });

    if (action === 'verify') {
      const email = String(e.parameter.email || '').trim().toLowerCase();
      const code = String(e.parameter.code || '').trim().toUpperCase();
      if (!email || !code) return json_({ ok: false, message: 'Email and code are required.' });
      return json_(verifySale_(email, code, true));
    }

    return json_({ ok: false, message: 'Invalid action.' });
  } catch (err) {
    return json_({ ok: false, message: String(err) });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    if (String(data.Secret || '') !== SHARED_SECRET) return json_({ ok: false, message: 'Unauthorized.' });

    const action = String(data.Action || 'recordSale').trim();

    // Backward compatible with the desktop app sale sync.
    if (action === 'recordSale') {
      const sheet = getSheet_(SALES_SHEET_NAME, SALES_HEADERS);
      const email = String(data.Email || '').trim().toLowerCase();
      const code = String(data.VerificationCode || '').trim().toUpperCase();
      if (!email || !code) return json_({ ok: false, message: 'Email and VerificationCode are required.' });

      sheet.appendRow([
        new Date(), data.ReceiptNo || '', data.ApplicantName || '', email,
        data.Phone || '', data.ClassApplyingFor || '', data.AmountPaid || '',
        data.FormLink || '', code, data.PaymentDate || '', data.ExpiryDate || '',
        data.Status || 'PAID', data.Used || 'NO', ''
      ]);
      return json_({ ok: true, message: 'Sale saved.' });
    }

    if (action === 'submitApplication') {
      const email = String(data.VerificationEmail || '').trim().toLowerCase();
      const code = String(data.VerificationCode || '').trim().toUpperCase();
      const app = data.Application || {};

      // Since verify already marks Used=YES, submit accepts the same email/code if it exists.
      const found = findSaleRow_(email, code);
      if (!found) return json_({ ok: false, message: 'Verification record not found. Please verify again.' });

      const sheet = getSheet_(APPLICATIONS_SHEET_NAME, APPLICATION_HEADERS);
      sheet.appendRow(APPLICATION_HEADERS.map(function(header) {
        if (header === 'SubmittedAt') return new Date();
        if (header === 'VerificationEmail') return email;
        if (header === 'VerificationCode') return code;
        if (header === 'ReceiptNo') return data.ReceiptNo || '';
        return app[header] || '';
      }));
      return json_({ ok: true, message: 'Application submitted.' });
    }

    return json_({ ok: false, message: 'Invalid action.' });
  } catch (err) {
    return json_({ ok: false, message: String(err) });
  }
}
