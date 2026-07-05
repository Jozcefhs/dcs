const statusEl = document.getElementById('confirmationStatus');
const box = document.getElementById('confirmationBox');

function setStatus(message, type) {
  statusEl.textContent = message || '';
  statusEl.className = 'status ' + (type || '');
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currency || 'NGN'
  }).format(Number(amount || 0));
}

async function verifyPayment() {
  const params = new URLSearchParams(window.location.search);
  const reference = params.get('reference') || params.get('trxref');
  const paymentType = params.get('type') || '';
  if (!reference) {
    setStatus('Payment reference is missing. Please contact the Admissions Office.', 'bad');
    return;
  }

  try {
    const isFormPurchase = paymentType.toLowerCase() === 'form';
    const response = await fetch(isFormPurchase ? '/api/verify-form-payment' : '/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Payment could not be verified.');
    }
    setStatus(isFormPurchase ? 'Admission form purchased successfully.' : 'Payment verified successfully.', 'ok');
    const details = document.createElement('div');
    details.className = 'receipt-box';
    const rows = isFormPurchase
      ? [
          ['Applicant', data.applicantName || 'Admission applicant'],
          ['Email', data.email || ''],
          ['Receipt No.', data.receiptNo || ''],
          ['Verification Code', data.verificationCode || ''],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference],
          ['Code Expiry Date', data.expiryDate || '']
        ]
      : [
          ['Fee', data.feeName || 'Online Payment'],
          ['Amount', formatMoney(data.amount, data.currency)],
          ['Reference', data.reference || reference]
        ];

    rows.forEach(([label, value]) => {
      if (!value) return;
      const line = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = `${label}: `;
      line.append(strong, document.createTextNode(value));
      details.appendChild(line);
    });
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = isFormPurchase
      ? 'Use this email address and verification code to register. A copy has also been sent to your email.'
      : 'Your payment has been recorded with the Admissions Office.';
    details.appendChild(note);
    if (isFormPurchase) {
      const link = document.createElement('p');
      const anchor = document.createElement('a');
      anchor.className = 'btn';
      anchor.href = data.formLink || 'verify.html';
      anchor.textContent = 'Register Now';
      link.appendChild(anchor);
      details.appendChild(link);
    }
    box.appendChild(details);
  } catch (error) {
    setStatus(error.message, 'bad');
  }
}

verifyPayment();
